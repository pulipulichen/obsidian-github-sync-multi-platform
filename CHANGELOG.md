# Changelog

## 1.0.10 — 2026-11-05

### Fixed: bulk deletion conflicts and files returning after deletion

- All GitHub Contents API writes from one Obsidian device now share a serialized queue, with bounded retry and backoff for branch contention and rate limits.
- Batch and folder deletes use a single-flight worker and an 800 ms debounce, not hundreds of competing DELETE requests.
- A repository-wide `.github-sync-deletions.json` journal records deleted paths before removing the actual files. Other upgraded clients consult this journal on full sync and move stale local copies to the Obsidian trash instead of re-uploading them.
- An intentional local CREATE event or the explicit force-overwrite action can restore a journaled path; ordinary stale MODIFY events cannot.
- A folder rename also queues tracked old file paths for deletion and uploads their new paths.
- A remote SHA edit discovered before deletion remains protected from automatic removal. Per-file failures are logged to the developer console and summarized in one notification.
- The deletion journal is synchronization metadata and must not itself be pulled into, or uploaded from, the Vault.
- GitHub commit history remains available for recovering deleted files.

### Important upgrade notes

- **Upgrade the plugin on every device** before performing another bulk cleanup. Older plugin builds do not understand the shared deletion journal and can still re-upload deleted files.
- Deletions made *directly* in the GitHub web interface do not create journal entries; they rely on the local per-device file inventory.
- The journal intentionally retains deleted paths; use a local explicit create or force-overwrite to reuse a previously deleted path.
- For testing, back up the Vault and first delete a small disposable folder on one device, then sync another device.


## 1.0.9 — 2026-11-04

### Fixed: Obsidian deletes were not propagated to GitHub

- Previously, the `delete` watcher did nothing when the local SHA cache lacked an entry. It now records a persistent deletion tombstone and looks up the latest remote SHA before issuing GitHub's Contents API DELETE request.
- Full sync previously pulled remote-only files before checking whether they had been deleted locally. It now compares the **last synchronized file inventory** with both local and remote file inventories before the pull phase.
- Local files deleted while Obsidian was closed, or while full sync had paused normal change watching, are queued for remote deletion rather than re-downloaded.
- Remote deletes made by another device are propagated to Obsidian by moving previously synchronized local files into **Obsidian trash** (not permanently deleting them).
- Delete failures retain tombstones for subsequent retries. HTTP 401/403/5xx errors are no longer treated as "remote file missing".
- A changed remote file is **not automatically deleted** when this device only knows an older remote SHA; a notice identifies the delete conflict.
- A local file being re-uploaded when the user deletes it is rechecked after the PUT finishes to avoid resurrecting the file.
- Folder deletion also queues all previously tracked descendants. Untracked files remain untouched during the first sync.
- Sync state writes are serialized, and state is reset when switching the configured repository/branch.
- A truncated GitHub tree cannot be used to infer remote deletions.

### Validation checklist

1. Delete a previously synchronized `.md` file locally: it should disappear from GitHub after the delete request completes.
2. Delete a synced PDF/image locally: it should disappear from GitHub.
3. Quit Obsidian, remove a synced file on disk, reopen Obsidian: the file should be removed from GitHub, **not restored** locally.
4. Delete a tracked file directly on GitHub, then run full sync on another device: the local copy should move to Obsidian trash, not be uploaded again.
5. Delete a folder of previously synchronized notes: all tracked children should be deleted remotely.
6. On a new device without sync history, run full sync: remote files should be downloaded, **not deleted**.
7. Make a remote edit after the device's last sync, then delete the local file offline: the newer remote version must be preserved and reported as a conflict.
8. Force GitHub to return an authentication or network error: deletion must remain pending for retry.

### Notes

- These changes are implemented using the GitHub Contents API; they do not invoke `git rm` or require Git binaries.
- GitHub history still retains deleted content in older commits; this only removes the file from the current branch.
- If a local device's plugin sync state (`data.json`) was already lost before this version, the plugin cannot reliably distinguish old local deletions from files never downloaded. It intentionally avoids deleting untracked remote-only files.
