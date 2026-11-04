// Regression tests against the real plugin code and a simulated GitHub API.
import assert from "node:assert/strict";
import { build } from "esbuild";

const db = new Map();
const notices = [];
globalThis.__notices = notices;
let locked = false, collisions = 0, seq = 0;
const reply = (status, json = {}) => ({ status, json, text: JSON.stringify(json) });
const delay = () => new Promise(resolve => setTimeout(resolve, 2));

globalThis.__request = async ({ url, method = "GET", body }) => {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith("/git/trees/main")) {
    return reply(200, { truncated: false, tree: [...db].map(([path, data]) => ({
      type: "blob", path, sha: data.sha,
      size: Buffer.from(data.content, "base64").length,
    })) });
  }
  const path = pathname.split("/contents/")[1].split("/").map(decodeURIComponent).join("/");
  const current = db.get(path);
  if (method === "GET") {
    return current
      ? reply(200, { path, sha: current.sha, content: current.content, size: 1 })
      : reply(404, { message: "Not Found" });
  }
  if (locked) {
    collisions++;
    return reply(409, { message: "Branch is busy" });
  }
  locked = true;
  try {
    await delay();
    const input = JSON.parse(body);
    if (method === "PUT") {
      if (current?.sha !== input.sha) return reply(409, { message: "SHA mismatch" });
      const sha = "test-sha-" + (++seq);
      db.set(path, { sha, content: input.content });
      return reply(current ? 200 : 201, { content: { sha } });
    }
    if (method === "DELETE") {
      if (!current) return reply(404);
      if (current.sha !== input.sha) return reply(409);
      db.delete(path);
      return reply(200, { commit: { sha: "commit-" + (++seq) } });
    }
    throw Error("Unsupported method " + method);
  } finally {
    locked = false;
  }
};

const source = await build({
  stdin: {
    contents: 'export { GitHubClient, REMOTE_DELETIONS_FILE } from "./src/lib/github-api.ts"; export { flushPendingDeletes, syncAllFilesImpl } from "./src/lib/fs.ts";',
    resolveDir: process.cwd(), sourcefile: "entry.ts", loader: "ts",
  },
  platform: "node", format: "esm", bundle: true, write: false,
  plugins: [{
    name: "obsidian-double",
    setup(tool) {
      tool.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      tool.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        loader: "js",
        contents: 'export class TAbstractFile {} export class TFile extends TAbstractFile {} export class Notice { constructor(message) { globalThis.__notices.push(message); } } export const moment = () => ({ format: () => "" }); export const requestUrl = (...args) => globalThis.__request(...args);',
      }));
    },
  }],
});
const code = Buffer.from(source.outputFiles[0].contents).toString("base64");
const { GitHubClient, REMOTE_DELETIONS_FILE, flushPendingDeletes, syncAllFilesImpl } =
  await import("data:text/javascript;base64," + code);

const newClient = () => new GitHubClient({
  owner: "test", repo: "notes", branch: "main", token: "test",
});
const newPlugin = (client, local = new Map()) => {
  const trashed = [];
  const plugin = {
    githubClient: client,
    app: { vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: path => local.get(path) ?? null,
      getFiles: () => [...local.values()],
      trash: async file => { local.delete(file.path); trashed.push(file.path); },
    } },
    settings: { syncEnabled: true, syncLargeFiles: false },
    syncData: { files: {}, pendingDeletes: {} },
    localCreations: new Set(), remoteDeletionPaths: new Set(),
    deletionFlushPromise: null, isSyncInProgress: false,
    disableWatch() {}, enableWatch() {},
    async saveSyncData() {}, async updateStats() {},
  };
  return { plugin, trashed };
};

const client = newClient();
const paths = Array.from({ length: 24 }, (_, i) => "folder/file-" + i + ".png");
const sha = await Promise.all(paths.map(path => client.putFile(path, "some-content")));
assert.equal(collisions, 0, "This device issued concurrent GitHub writes");

const { plugin } = newPlugin(client);
for (let i = 0; i < paths.length; i++) {
  plugin.syncData.files[paths[i]] = { sha: sha[i], lastSync: Date.now() };
  plugin.syncData.pendingDeletes[paths[i]] = Date.now();
}
await Promise.all([flushPendingDeletes(plugin), flushPendingDeletes(plugin)]);
assert.equal(Object.keys(plugin.syncData.pendingDeletes).length, 0);
assert(paths.every(path => !db.has(path)), "A supposedly deleted file remains");
const journal = await client.getRemoteDeletions();
assert(paths.every(path => Object.hasOwn(journal, path)), "Journal omitted a deletion");
assert(db.has(REMOTE_DELETIONS_FILE));
assert.equal(notices.length, 0, "Bulk deletion generated multiple notifications");

const local = new Map([[paths[0], { path: paths[0], extension: "png", stat: { size: 1, mtime: 1 } }]]);
const second = newPlugin(newClient(), local);
await syncAllFilesImpl(second.plugin);
assert.deepEqual(second.trashed, [paths[0]], "Another device restored deleted content");
assert(!db.has(paths[0]));

const a = newClient(), b = newClient();
await Promise.all([
  a.updateRemoteDeletions(["device-a.md"]),
  b.updateRemoteDeletions(["device-b.md"]),
]);
const merged = await client.getRemoteDeletions();
assert(Object.hasOwn(merged, "device-a.md") && Object.hasOwn(merged, "device-b.md"));

const previousSha = await client.putFile("conflict.md", "first");
await b.putFile("conflict.md", "newer", previousSha);
const stale = newPlugin(client).plugin;
stale.syncData.files["conflict.md"] = { sha: previousSha, lastSync: Date.now() };
stale.syncData.pendingDeletes["conflict.md"] = Date.now();
await flushPendingDeletes(stale);
assert(db.has("conflict.md"), "Newer GitHub edit was incorrectly deleted");
assert(Object.hasOwn(stale.syncData.pendingDeletes, "conflict.md"));
assert(!Object.hasOwn(await client.getRemoteDeletions(), "conflict.md"));

const original = db.get(REMOTE_DELETIONS_FILE);
db.set(REMOTE_DELETIONS_FILE, {
  sha: "invalid-sha",
  content: Buffer.from("{ invalid").toString("base64"),
});
await assert.rejects(() => client.getRemoteDeletions(), /Cannot read deletion journal/);
db.set(REMOTE_DELETIONS_FILE, original);

console.log("Bulk deletion and cross-device sync regression checks passed.");
