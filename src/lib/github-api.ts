import { requestUrl } from "obsidian";

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface GitHubFileResponse {
  content: string;
  sha: string;
  path: string;
  size: number;
  download_url?: string;
}

export interface GitHubTreeNode {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeNode[];
  truncated: boolean;
}

export const REMOTE_DELETIONS_FILE = ".github-sync-deletions.json";

interface RemoteDeletionManifest {
  version: 1;
  paths: Record<string, number>;
}

export class GitHubClient {
  private config: GitHubConfig;
  // The Contents API updates the branch tip for every PUT/DELETE.
  // Serializing *all* writes avoids competing requests from this device.
  private writeQueue: Promise<void> = Promise.resolve();

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async retryDelay(attempt: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(8000, 500 * (2 ** attempt))));
  }

  private isRetryable(status: number, body: string): boolean {
    return status === 0 || status === 408 || status === 409 ||
      status === 429 || status >= 500 ||
      (status === 403 && /rate limit|abuse|secondary/i.test(body));
  }

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  private get baseUrl() {
    return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
  }

  public get headers() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };
  }

  async getFile(path: string): Promise<GitHubFileResponse | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/contents/${encodedPath}?ref=${this.config.branch}`;
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.headers,
        throw: false,
      });

      if (response.status === 200) {
        return response.json as GitHubFileResponse;
      }
      if (response.status === 404) return null;
      throw new Error(`Failed to get ${path}: HTTP ${response.status} ${response.text}`);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  async putFile(path: string, content: string | ArrayBuffer, sha?: string): Promise<string> {
    return this.enqueueWrite(async () => {
      let currentSha = sha;
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await this._doPutRequest(path, content, currentSha);
        if (response.status === 200 || response.status === 201) {
          return (response.json as { content: { sha: string } }).content.sha;
        }

        // Other devices may have updated the branch, or this file's SHA
        // may have changed. Re-read the current file before retrying.
        if (response.status === 409 || response.status === 422) {
          const remote = await this.getFile(path);
          if (response.status === 422 && !remote) {
            throw new Error(`Failed to put ${path}: HTTP 422 ${response.text}`);
          }
          currentSha = remote?.sha;
        } else if (!this.isRetryable(response.status, response.text)) {
          throw new Error(`Failed to put ${path}: HTTP ${response.status} ${response.text}`);
        }

        if (attempt < 4) await this.retryDelay(attempt);
      }
      throw new Error(`Failed to put ${path} after 5 attempts`);
    });
  }

  private async _doPutRequest(
    path: string,
    content: string | ArrayBuffer,
    sha?: string
  ): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/contents/${encodedPath}`;

    let base64Content: string;
    if (typeof content === "string") {
      const uint8 = new TextEncoder().encode(content);
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      base64Content = btoa(binary);
    } else {
      const bytes = new Uint8Array(content);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Content = btoa(binary);
    }

    const body: Record<string, unknown> = {
      message: `sync: ${sha ? "update" : "create"} ${path}`,
      content: base64Content,
      branch: this.config.branch,
    };
    if (sha) body.sha = sha;

    // requestUrl 在收到 4xx/5xx 时默认抛出异常而非返回
    // 加 throw: false 确保始终返回响应对象，使 409/422 状态码判断 100% 生效
    try {
      const res = await requestUrl({
        url,
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify(body),
        throw: false,
      });
      return { status: res.status, json: res.json as Record<string, unknown>, text: res.text };
    } catch (err: unknown) {
      // 备用分支：如果 throw:false 不生效，捕获异常并返回
      const e = err as { status?: number; message?: string };
      return {
        status: e.status ?? 0,
        json: {} as Record<string, unknown>,
        text: e.message ?? String(err),
      };
    }
  }

  async deleteFile(path: string, sha: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const url = `${this.baseUrl}/contents/${encodedPath}`;

      for (let attempt = 0; attempt < 5; attempt++) {
        let status = 0;
        let responseText = "";
        try {
          const response = await requestUrl({
            url,
            method: "DELETE",
            headers: this.headers,
            body: JSON.stringify({ message: `sync: delete ${path}`, sha, branch: this.config.branch }),
            throw: false,
          });
          status = response.status;
          responseText = response.text;
        } catch (error) {
          const typed = error as { status?: number; message?: string };
          status = typed.status ?? 0;
          responseText = typed.message ?? String(error);
        }

        if (status === 200 || status === 204 || status === 404) return;
        if (status === 409 || status === 422) {
          const remote = await this.getFile(path);
          if (!remote) return;
          // Never discard someone else's change while retrying a deletion.
          if (remote.sha !== sha) {
            throw new Error(`Delete conflict: ${path} changed on GitHub`);
          }
        } else if (!this.isRetryable(status, responseText)) {
          throw new Error(`Failed to delete ${path}: HTTP ${status} ${responseText}`);
        }

        if (attempt < 4) await this.retryDelay(attempt);
      }
      throw new Error(`Failed to delete ${path} after 5 attempts (branch contention)`);
    });
  }

  /**
   * Repository-wide deletion journal: another device may lack a local SHA
   * cache, so absence on GitHub alone is not enough to prevent re-upload.
   * Malformed journals fail closed instead of silently resurrecting files.
   */
  async getRemoteDeletions(): Promise<Record<string, number>> {
    const remote = await this.getFile(REMOTE_DELETIONS_FILE);
    if (!remote) return {};
    return this.parseRemoteDeletions(remote.content);
  }

  private parseRemoteDeletions(content: string): Record<string, number> {
    try {
      const parsed = JSON.parse(GitHubClient.decodeContent(content)) as RemoteDeletionManifest;
      if (parsed.version !== 1 || !parsed.paths || typeof parsed.paths !== "object" ||
          Array.isArray(parsed.paths)) {
        throw new Error("Unsupported deletion journal format");
      }
      const paths: Record<string, number> = {};
      for (const [path, timestamp] of Object.entries(parsed.paths)) {
        if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
          throw new Error("Invalid deletion timestamp");
        }
        Object.defineProperty(paths, path, { value: timestamp, writable: true, enumerable: true, configurable: true });
      }
      return paths;
    } catch (error) {
      throw new Error(`Cannot read deletion journal: ${(error as Error).message}`);
    }
  }

  async updateRemoteDeletions(mark: string[] = [], clear: string[] = []): Promise<void> {
    if (mark.length === 0 && clear.length === 0) return;
    return this.enqueueWrite(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await this.getFile(REMOTE_DELETIONS_FILE);
        const current = remote ? this.parseRemoteDeletions(remote.content) : {};
        let changed = false;
        const now = Date.now();
        for (const path of mark) {
          if (!Object.prototype.hasOwnProperty.call(current, path)) {
            Object.defineProperty(current, path, { value: now, writable: true, enumerable: true, configurable: true });
            changed = true;
          }
        }
        for (const path of clear) {
          if (Object.prototype.hasOwnProperty.call(current, path)) {
            delete current[path];
            changed = true;
          }
        }
        if (!changed) return;

        const content = JSON.stringify({ version: 1, paths: current }, null, 2) + "\n";
        const response = await this._doPutRequest(REMOTE_DELETIONS_FILE, content, remote?.sha);
        if (response.status === 200 || response.status === 201) return;
        if ((response.status === 409 || response.status === 422 ||
            this.isRetryable(response.status, response.text)) && attempt < 4) {
          await this.retryDelay(attempt);
          continue;
        }
        throw new Error(`Failed to update deletion journal: HTTP ${response.status} ${response.text}`);
      }
      throw new Error("Failed to update deletion journal after 5 attempts");
    });
  }

  async getLatestCommit(path?: string): Promise<string | null> {
    let url = `${this.baseUrl}/commits?sha=${this.config.branch}&per_page=1`;
    if (path) {
      url += `&path=${encodeURIComponent(path)}`;
    }

    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
    });

    if (response.status === 200 && response.json.length > 0) {
      return response.json[0].sha;
    }
    return null;
  }

  async getTree(): Promise<GitHubTree> {
    const url = `${this.baseUrl}/git/trees/${this.config.branch}?recursive=1`;
    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
      throw: false,
    });
    if (response.status === 200) {
      return response.json as GitHubTree;
    }
    // 全新空倉庫沒有 commit / tree，GitHub Trees API 會回 409。
    // 當成「遠端沒有任何檔案」，讓後續同步能用 Contents API 建立第一個 commit。
    if (this.isEmptyRepositoryResponse(response.status, response.text)) {
      return { sha: "", url: "", tree: [], truncated: false };
    }
    throw new Error(`Failed to get tree: HTTP ${response.status} - ${response.text}`);
  }

  private isEmptyRepositoryResponse(status: number, text: string): boolean {
    return status === 409 && /Git Repository is empty/i.test(text);
  }

  // Helper to decode base64 content from GitHub
  static decodeContent(base64Content: string): string {
    const binary = atob(base64Content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
}
