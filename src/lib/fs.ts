import { TFile, TAbstractFile, Notice, requestUrl } from "obsidian";

import { hashContent, dump } from "./helps";
import FastSync from "../main";
import { GitHubClient, GitHubTreeNode } from "./github-api";

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const LARGE_FILE_MAX_SIZE = 100 * 1024 * 1024; // GitHub Contents API upper bound

const getMaxFileSize = (plugin: FastSync): number =>
  plugin.settings.syncLargeFiles ? LARGE_FILE_MAX_SIZE : DEFAULT_MAX_FILE_SIZE;

const isFileTooLarge = (size: number, plugin: FastSync): boolean =>
  size > getMaxFileSize(plugin);

const getMaxFileSizeLabel = (plugin: FastSync): string =>
  plugin.settings.syncLargeFiles ? "100MB" : "10MB";

/**
 * 核心修改逻辑，包含防抖和哈希校验
 */
export const NoteModify = function (file: TAbstractFile, plugin: FastSync, eventEnter: boolean = false) {
  if (!(file instanceof TFile)) return;
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (plugin.ignoredFiles.has(file.path) && eventEnter) return;
  if (!plugin.githubClient) return;

  // 1. 文件大小限制：默认 10MB；开启大文件同步后最高 100MB
  if (isFileTooLarge(file.stat.size, plugin)) {
    new Notice(`File too large (>${getMaxFileSizeLabel(plugin)}): ${file.path}. Skipped sync.`);
    return;
  }

  // 2. 防抖处理
  if (plugin.debounceTimers.has(file.path)) {
    clearTimeout(plugin.debounceTimers.get(file.path));
  }

  const timer = window.setTimeout(() => {
    void (async () => {
      plugin.debounceTimers.delete(file.path);
      await performSync(file, plugin);
    })();
  }, 5000); // 5秒防抖

  plugin.debounceTimers.set(file.path, timer);
};

const performSync = async (file: TFile, plugin: FastSync) => {
  plugin.addIgnoredFile(file.path);
  try {
    const isMarkdown = file.extension === "md";

    let content: string | ArrayBuffer;
    let currentHash: string;

    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
      currentHash = hashContent(content);
    } else {
      content = await plugin.app.vault.readBinary(file);
      // 对二进制文件使用简单的摘要校验
      currentHash = file.stat.size + "_" + file.stat.mtime;
    }

    // 3. 检查内容是否真正变化 (对比缓存的哈希)
    if (plugin.syncData.files[file.path]?.hash === currentHash) {
      dump(`No content change for ${file.path}, skip sync.`);
      return;
    }

    const sha = plugin.syncData.files[file.path]?.sha;
    const newSha = await plugin.githubClient.putFile(file.path, content, sha);

    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentHash
    };
    await plugin.saveSyncData();
    dump(`Synced ${file.path} to GitHub`, newSha);

  } catch (error) {
    console.error("Sync failed:", error);
    new Notice(`Sync failed for ${file.path}: ${error.message}`);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};


/** The dashboard's generated statistics file is not a Vault note. */
const isInternalSyncPath = (path: string, plugin: FastSync): boolean =>
  path === plugin.app.vault.configDir + "/sync-stats.json";

/**
 * Keep deletion tombstones until GitHub confirms each delete. A remote edit
 * made since this device last synced is a conflict, never silently discarded.
 */
export async function flushPendingDeletes(
  plugin: FastSync,
  remoteFilesMap?: Map<string, string>
): Promise<void> {
  if (!plugin.githubClient) return;

  for (const path of Object.keys(plugin.syncData.pendingDeletes)) {
    if (plugin.deletingPaths.has(path)) continue;
    plugin.deletingPaths.add(path);
    try {
      // A file may have been recreated before the remote delete was attempted.
      if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) {
        delete plugin.syncData.pendingDeletes[path];
        await plugin.saveSyncData();
        continue;
      }

      if (isInternalSyncPath(path, plugin)) {
        delete plugin.syncData.pendingDeletes[path];
        await plugin.saveSyncData();
        continue;
      }

      const remoteFile = await plugin.githubClient.getFile(path);
      const lastKnownSha = plugin.syncData.files[path]?.sha;
      if (remoteFile && lastKnownSha && remoteFile.sha !== lastKnownSha) {
        console.warn("Remote deletion conflict for " + path + ": remote content changed");
        new Notice("Delete conflict: " + path + " changed on GitHub; remote copy preserved.");
        continue;
      }

      if (remoteFile) {
        await plugin.githubClient.deleteFile(path, remoteFile.sha);
      }
      delete plugin.syncData.files[path];
      delete plugin.syncData.pendingDeletes[path];
      remoteFilesMap?.delete(path);
      await plugin.saveSyncData();
      dump("Deleted " + path + " from GitHub (or already absent)");
    } catch (error) {
      // Keep the tombstone so a later full sync can retry without restoring it.
      console.error("Delete failed for " + path + "; will retry at next sync:", error);
      new Notice("Delete failed for " + path + "; will retry during next sync.");
    } finally {
      plugin.deletingPaths.delete(path);
    }
  }
}

/**
 * A live delete is recorded even while a full sync has its watcher disabled.
 * Folder deletes queue every previously tracked descendant.
 */
export const NoteDelete = async function (
  file: TAbstractFile,
  plugin: FastSync,
  eventEnter: boolean = false
) {
  if (eventEnter && !plugin.settings.syncEnabled) return;
  if (!plugin.githubClient) return;

  const targets = file instanceof TFile
    ? [file.path]
    : [...Object.keys(plugin.syncData.files), ...Object.keys(plugin.syncData.pendingDeletes)]
        .filter(path => path.startsWith(file.path + "/"));

  let queued = false;
  for (const path of new Set(targets)) {
    if (isInternalSyncPath(path, plugin)) continue;
    // Only our own remote->local trash operations are excluded.
    if (eventEnter && plugin.remoteDeletionPaths.has(path)) continue;
    if (plugin.debounceTimers.has(path)) {
      clearTimeout(plugin.debounceTimers.get(path));
      plugin.debounceTimers.delete(path);
    }
    plugin.syncData.pendingDeletes[path] = Date.now();
    queued = true;
  }

  if (!queued) return;
  await plugin.saveSyncData();
  if (!plugin.isSyncInProgress) {
    await flushPendingDeletes(plugin);
  }
};

export const NoteRename = async function (file: TAbstractFile, oldfile: string, plugin: FastSync, eventEnter: boolean = false) {
  if (!(file instanceof TFile)) return;
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (eventEnter && !plugin.settings.syncEnabled) return;
  if (!plugin.githubClient) return;
  if (isFileTooLarge(file.stat.size, plugin)) {
    new Notice(`File too large (>${getMaxFileSizeLabel(plugin)}): ${file.path}. Skipped sync.`);
    return;
  }

  plugin.addIgnoredFile(file.path);
  try {
    // 1. Queue the old path even if its SHA was never cached.
    if (oldfile !== file.path) {
      plugin.syncData.pendingDeletes[oldfile] = Date.now();
      await plugin.saveSyncData();
      await flushPendingDeletes(plugin);
    }

    // 2. 上传新路径
    const isMarkdown = file.extension === "md";
    let content: string | ArrayBuffer;
    let currentHash: string;

    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
      currentHash = hashContent(content);
    } else {
      content = await plugin.app.vault.readBinary(file);
      currentHash = file.stat.size + "_" + file.stat.mtime;
    }

    const newSha = await plugin.githubClient.putFile(file.path, content);
    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentHash
    };
    await plugin.saveSyncData();
    dump(`Renamed ${oldfile} -> ${file.path}`);
  } catch (error) {
    console.error("Rename failed:", error);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};

/**
 * 初始化与同步逻辑 (保持之前实现的 Full Sync, 稍作修改以适配 hash)
 */

export async function overrideRemoteAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) {
    new Notice("Sync in progress...");
    return;
  }
  if (!plugin.githubClient) return;

  plugin.isSyncInProgress = true;
  plugin.disableWatch();
  
  try {
    const files = plugin.app.vault.getFiles();
    for (const file of files) {
       if (isFileTooLarge(file.stat.size, plugin)) continue;
       
       const isMarkdown = file.extension === "md";

       let content: string | ArrayBuffer;
       let currentHash: string;

       if (isMarkdown) {
         content = await plugin.app.vault.read(file);
         currentHash = hashContent(content);
       } else {
         content = await plugin.app.vault.readBinary(file);
         currentHash = file.stat.size + "_" + file.stat.mtime;
       }

       const sha = plugin.syncData.files[file.path]?.sha;
       const newSha = await plugin.githubClient.putFile(file.path, content, sha);
       plugin.syncData.files[file.path] = {
         sha: newSha,
         lastSync: Date.now(),
         hash: currentHash
       };
    }
    await plugin.saveSyncData();
    // B6: updateStats 异步执行，不阻塞主流程
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("All assets synced to GitHub");
  } catch (error) {
    console.error("Force sync failed:", error);
    // B3: 失败时弹出通知，用户可感知
    new Notice(`Sync failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesForceOverSync = (plugin: FastSync): void => {
  void overrideRemoteAllFilesImpl(plugin);
};

export async function syncAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) return;
  if (!plugin.githubClient) return;

  plugin.isSyncInProgress = true;
  plugin.disableWatch();

  try {
    const remoteTree = await plugin.githubClient.getTree();
    if (remoteTree.truncated) {
      throw new Error("GitHub returned a truncated tree; refusing to infer deletions.");
    }
    const allRemoteFilesMap = new Map<string, string>(
      remoteTree.tree.filter(node => node.type === "blob").map(node => [node.path, node.sha])
    );
    // 同步 GitHub 仓库中的所有文件；Markdown 以文字处理，其余文件以 binary 处理。
    // 默认跳过 >10MB；开启“大文件同步”后允许到 GitHub Contents API 的 100MB 上限。
    const maxFileSize = getMaxFileSize(plugin);
    const remoteFiles = remoteTree.tree.filter((node: GitHubTreeNode) => {
      return node.type === "blob" && (node.size === undefined || node.size <= maxFileSize);
    });
    const remoteFilesMap = new Map<string, string>(remoteFiles.map((f: GitHubTreeNode) => [f.path, f.sha] as [string, string]));

    const allLocalFiles = plugin.app.vault.getFiles();
    const localFilesMap = new Map<string, TFile>(allLocalFiles.map(f => [f.path, f]));
    const protectedFromUpload = new Set<string>();

    // Reconcile deletions BEFORE the pull phase. Never treat an untracked
    // remote-only file as locally deleted on a device's first sync.
    for (const path of Object.keys(plugin.syncData.files)) {
      if (isInternalSyncPath(path, plugin)) continue;
      const localFile = localFilesMap.get(path);
      const remoteSha = allRemoteFilesMap.get(path);

      if (!localFile && remoteSha) {
        // File disappeared locally while the app was closed or watching was off.
        plugin.syncData.pendingDeletes[path] ??= Date.now();
      } else if (localFile && !remoteSha) {
        // Another device deleted this previously-synced file from GitHub.
        // Obsidian trash (rather than permanent deletion) permits recovery.
        plugin.remoteDeletionPaths.add(path);
        try {
          await plugin.app.vault.trash(localFile, false);
          localFilesMap.delete(path);
          delete plugin.syncData.files[path];
          delete plugin.syncData.pendingDeletes[path];
          dump("Moved remotely deleted file to Obsidian trash: " + path);
        } catch (error) {
          console.error("Could not trash remotely deleted file " + path, error);
          protectedFromUpload.add(path);
        } finally {
          plugin.remoteDeletionPaths.delete(path);
        }
      } else if (!localFile && !remoteSha) {
        delete plugin.syncData.files[path];
        delete plugin.syncData.pendingDeletes[path];
      }
    }

    await plugin.saveSyncData();
    await flushPendingDeletes(plugin, remoteFilesMap);

    // 1. 下拉远端变更
    let step1Count = 0;
    for (const [path, remoteSha] of Array.from(remoteFilesMap.entries())) {
      if (plugin.syncData.pendingDeletes[path]) continue;
      try {
        const localFile = localFilesMap.get(path);
        const localState = plugin.syncData.files[path];

        const isLocalFileEmpty = localFile && localFile.stat.size === 0;
        
        if (!localFile || (localState && localState.sha !== remoteSha) || isLocalFileEmpty) {
          const remoteData = await plugin.githubClient.getFile(path);
          if (remoteData) {
            if (isFileTooLarge(remoteData.size, plugin)) continue;

            const ext = path.split(".").pop()?.toLowerCase();
            const isMarkdown = ext === "md";
            
            plugin.addIgnoredFile(path);
            
            const folderPath = path.split("/").slice(0, -1).join("/");
            if (folderPath && !plugin.app.vault.getAbstractFileByPath(folderPath)) {
              await plugin.app.vault.createFolder(folderPath);
            }

            let finalContent: string | ArrayBuffer;
            if (!remoteData.content && remoteData.download_url) {
              const downloadRes = await requestUrl({ 
                url: remoteData.download_url,
                headers: plugin.githubClient.headers
              });
              finalContent = downloadRes.arrayBuffer;
            } else {
              finalContent = remoteData.content;
            }

            if (isMarkdown) {
              const content = typeof finalContent === "string" 
                ? GitHubClient.decodeContent(finalContent)
                : new TextDecoder().decode(finalContent);
                
              if (localFile) await plugin.app.vault.modify(localFile, content);
              else await plugin.app.vault.create(path, content);
              
              plugin.syncData.files[path] = {
                sha: remoteSha,
                lastSync: Date.now(),
                hash: hashContent(content)
              };
            } else {
              let buffer: ArrayBuffer;
              if (typeof finalContent === "string") {
                const binaryString = atob(finalContent.replace(/\n/g, ""));
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                buffer = bytes.buffer;
              } else {
                buffer = finalContent;
              }
              
              if (localFile) await plugin.app.vault.modifyBinary(localFile, buffer);
              else await plugin.app.vault.createBinary(path, buffer);
              
              const newlyCreatedFile = plugin.app.vault.getAbstractFileByPath(path);
              if (newlyCreatedFile instanceof TFile) {
                 plugin.syncData.files[path] = {
                   sha: remoteSha,
                   lastSync: Date.now(),
                   hash: newlyCreatedFile.stat.size + "_" + newlyCreatedFile.stat.mtime
                 };
              }
            }
            plugin.removeIgnoredFile(path);
            step1Count++;
          }
        }
      } catch (fileError) {
        // 单个文件失败不中断整个同步
        console.error(`Step1 failed for ${path}:`, fileError);
      }
    }


    // 2. 推送本地文件：新增文件 + 本地内容有变化的已有文件
    let step2Push = 0, step2Skip = 0, step2Fail = 0;
    for (const file of allLocalFiles) {
      // The snapshot may include a file removed by remote deletion reconciliation.
      if (plugin.app.vault.getAbstractFileByPath(file.path) !== file) continue;
      if (plugin.syncData.pendingDeletes[file.path] || protectedFromUpload.has(file.path)) continue;
      const isMarkdown = file.extension === "md";
      if (isFileTooLarge(file.stat.size, plugin)) continue;

      try {
        const remoteSha = remoteFilesMap.get(file.path);
        const localState = plugin.syncData.files[file.path];

        // 计算当前内容 hash
        let content: string | ArrayBuffer;
        let currentHash: string;
        if (isMarkdown) {
          content = await plugin.app.vault.read(file);
          currentHash = hashContent(content);
        } else {
          content = await plugin.app.vault.readBinary(file);
          currentHash = file.stat.size + "_" + file.stat.mtime;
        }

        if (!remoteSha) {
          // 远端没有 → 新增文件，直接上传
          const newSha = await plugin.githubClient.putFile(file.path, content);
          plugin.syncData.files[file.path] = {
            sha: newSha,
            lastSync: Date.now(),
            hash: currentHash
          };
          step2Push++;
        } else if (!localState || localState.hash !== currentHash) {
          // B2: 远端有、但本地内容发生了变化 → 推送本地改动
          const newSha = await plugin.githubClient.putFile(file.path, content, remoteSha);
          plugin.syncData.files[file.path] = {
            sha: newSha,
            lastSync: Date.now(),
            hash: currentHash
          };
          step2Push++;
        } else {
          // 两端内容一致，只更新本地 sha 缓存（防止 performSync 重复触发）
          plugin.syncData.files[file.path] = {
            sha: remoteSha,
            lastSync: plugin.syncData.files[file.path]?.lastSync ?? Date.now(),
            hash: currentHash  // 更新为当前真实 hash
          };
          step2Skip++;
        }
      } catch (fileError) {
        // 单个文件失败不中断整个同步
        console.error(`Step2 failed for ${file.path}:`, fileError);
        step2Fail++;
      }
    }
    
    // Catch user deletes that arrived while the pull/push steps were running.
    await flushPendingDeletes(plugin, remoteFilesMap);
    await plugin.saveSyncData();
    // B6: updateStats 异步执行，不阻塞主同步流程
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("Sync completed");
  } catch (error) {
    console.error("Sync failed:", error);
    // B3: 同步失败时弹出通知
    new Notice(`❌ Sync failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesSync = (plugin: FastSync): void => {
  void syncAllFilesImpl(plugin);
};
