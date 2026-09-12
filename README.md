# Github-Sync-Multi-Platform

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Zhang-cm/github-sync-multi-platform?style=flat-square)](https://github.com/Zhang-cm/github-sync-multi-platform/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=9437ff&label=downloads&query=github-sync-multi-platform.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=github-sync-multi-platform)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[English](#english) | [简体中文](#chinese) | [繁體中文](#traditional-chinese)

---

<a name="english"></a>

## 🚀 Overview

**Github-Sync-Multi-Platform** is a high-performance, serverless synchronization solution. It leverages the GitHub REST API to provide seamless, real-time note synchronization across Desktop (Windows/macOS/Linux) and Mobile (iOS/Android) devices within your notes environment.

Unlike traditional Git-based plugins, this tool interacts directly with the GitHub API, eliminating the need for a local Git environment on mobile devices and providing a faster, more stable experience.

### ✨ Key Features

-   **Native Mobile Support**: Full compatibility with iOS and Android without requiring Git binaries.
-   **Real-time Auto-Sync**: Intelligent event listening triggers synchronization on file modification with a 5-second debounce to optimize API usage.
-   **Serverless Architecture**: No middle-man server required. Your data goes directly to your private GitHub repository.
-   **Conflict Resolution**: Built-in hash-based change detection to minimize sync conflicts.
-   **All File Types**: Syncs Markdown as text and all other Vault files as binary data.
-   **Optional Large File Sync**: Files up to 10MB are synced by default. Enable "Sync large files" to allow files larger than 10MB, up to the GitHub Contents API limit of 100MB per file.
-   **Visual Dashboard**: Support for a web-based dashboard to visualize your writing progress and sync stats.

## 🛠 Tech Stack

-   **Core**: TypeScript, Plugin API.
-   **UI**: Vanilla CSS, native Obsidian setting controls.
-   **Network**: GitHub REST API (v3).
-   **Build**: esbuild for high-speed bundling.

## 📥 Installation

1.  Open **Settings** > **Community plugins**.
2.  Disable **Restricted mode**.
3.  Click **Browse** and search for `Github Sync (Multi-Platform)`.
4.  Click **Install**, then **Enable**.

*(Alternatively, download the latest release and place `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/github-sync-multi-platform/`)*

## ⚙️ Configuration

1.  **GitHub Token**: Generate a [Personal Access Token (PAT)](https://github.com/settings/tokens) with `repo` scope.
2.  **Repo Settings**:
    -   **Owner**: Your GitHub username.
    -   **Repo**: Your private notes repository name.
    -   **Branch**: Typically `main`.
3.  **Sync Options**: Enable "Auto Sync" for the real-time experience.
4.  **Large Files**: "Sync large files" is disabled by default. When enabled, files larger than 10MB can be synchronized, up to 100MB per file. Large files consume more memory and API bandwidth, especially on mobile devices.

## ❓ FAQ

For detailed information about synchronization mechanisms, incremental sync, and conflict resolution, please refer to our [FAQ Document](docs/FAQ.md).

---

<a name="chinese"></a>

## 🚀 项目简介

**Github-Sync-Multi-Platform** 是一款高性能、无服务器同步方案。它直接利用 GitHub REST API，在桌面端（Windows/macOS/Linux）与移动端（iOS/Android）之间提供流畅的实时笔记同步体验。

与传统的基于 Git 命令行工具的插件不同，本项目通过 API 直接操作，在移动端无需安装 Git 环境，运行更轻快、更稳定。

### ✨ 核心特性

-   **原生移动端支持**：完美适配 iOS 和 Android，无需复杂的 Git 环境配置。
-   **实时自动同步**：智能监听文件修改事件，内置 5 秒防抖（Debounce）逻辑，平衡实时性与 API 调用额度。
-   **无服务器架构**：数据直接点对点传输至您的私有 GitHub 仓库，隐私安全。
-   **冲突检测**：基于内容哈希的智能检测，最大限度减少同步冲突。
-   **所有文件类型**：Markdown 以文本方式同步，Vault 内其他文件统一以二进制方式同步。
-   **可选大文件同步**：默认同步单文件最高 10MB；开启“同步大文件”后可同步超过 10MB 的文件，单文件最高受 GitHub Contents API 100MB 限制。
-   **可视化看板**：配套数据看板，直观展示写作进度与同步状态。

## 🛠 技术架构

-   **核心**: TypeScript, Plugin API.
-   **UI 框架**: 原生 CSS, Obsidian 内置设置组件.
-   **通信**: GitHub REST API (v3).
-   **构建工具**: esbuild 极速打包.

## 📥 安装方式

1.  打开 **设置** > **第三方插件**。
2.  关闭 **安全模式**。
3.  点击 **浏览** 并搜索 `Github Sync (Multi-Platform)`。
4.  点击 **安装**，随后 **启用**。

*(或从 Release 页面下载最新版本，将 `main.js`、`manifest.json`、`styles.css` 放入 `.obsidian/plugins/github-sync-multi-platform/` 目录)*

## ⚙️ 配置指南

1.  **GitHub 令牌**: 访问 [GitHub Settings](https://github.com/settings/tokens) 生成一个具有 `repo` 权限的个人访问令牌 (PAT)。
2.  **仓库配置**:
    -   **Owner**: 您的 GitHub 用户名。
    -   **Repo**: 您的私有笔记仓库名称。
    -   **Branch**: 默认为 `main`。
3.  **同步选项**: 开启“启用同步”即可享受实时同步体验。
4.  **大文件同步**: “同步大文件”默认关闭。开启后可同步超过 10MB 的文件，单文件最高 100MB。大文件会消耗更多内存与 API 流量，移动设备上尤其需要注意。

## ❓ 常见问题 (FAQ)

关于同步机制、增量同步以及多设备冲突处理的详细说明，请参阅 [常见问题解答 (FAQ)](docs/FAQ.md)。

---

<a name="traditional-chinese"></a>

## 🚀 專案簡介

**Github-Sync-Multi-Platform** 是一款高效能、無伺服器的 Obsidian 同步方案。它直接使用 GitHub REST API，在桌面端（Windows/macOS/Linux）與行動裝置（iOS/Android）之間提供即時同步，不需要在手機上安裝 Git。

與傳統依賴 Git 指令列的同步外掛不同，本專案直接透過 GitHub API 操作，因此在不同平台上都能使用相同的同步機制。

### ✨ 核心功能

-   **原生行動裝置支援**：支援 iOS 與 Android，不需要 Git 執行檔。
-   **即時自動同步**：監聽檔案建立、修改、重新命名與刪除事件，並使用 5 秒 Debounce 減少不必要的 API 呼叫。
-   **雙向完整同步**：啟動外掛、點擊側邊同步按鈕或執行「同步全部筆記」時，會先 Pull GitHub 的變更，再 Push 本機變更。
-   **所有檔案類型**：Markdown（`.md`）以文字方式同步；PDF、Canvas、Base、JSON、CSV、圖片、Office 文件等其他 Vault 檔案則以 Binary 方式同步。
-   **大檔案同步開關**：預設只同步單一檔案不超過 10 MB；可在外掛設定中開啟「同步大檔案」，允許同步超過 10 MB 的檔案，單一檔案最高仍受 GitHub Contents API 100 MB 限制。
-   **增量同步**：透過 SHA 與內容雜湊判斷是否真的發生變更，未變更的檔案不會重複上傳。
-   **無中介伺服器**：資料直接在 Obsidian 與你的 GitHub Repository 之間傳輸。
-   **衝突處理**：目前採最後寫入者優先（Last Write Wins），並非 Git 三方合併。

## 🛠 技術架構

-   **核心**：TypeScript、Obsidian Plugin API
-   **介面**：原生 Obsidian Setting API / CSS
-   **網路**：GitHub REST API
-   **建置**：esbuild

## 📥 安裝方式

### 官方 Community Plugin

1. 開啟 Obsidian **設定** > **第三方外掛**。
2. 關閉 Restricted mode（受限模式）。
3. 點擊 **瀏覽**，搜尋 `Github Sync (Multi-Platform)`。
4. 安裝並啟用。

### 安裝此 Fork

若要使用此 Fork 新增的「所有檔案類型同步」與「大檔案同步」功能，建議透過 BRAT 安裝此 Repository，或從本 Repository 的 Release 下載：

- `main.js`
- `manifest.json`
- `styles.css`

並放入：

```text
<Vault>/.obsidian/plugins/github-sync-multi-platform/
```

## ⚙️ 設定方式

1. **GitHub Token**
   - 建立具有 Repository 寫入權限的 GitHub Personal Access Token。
2. **Repository 設定**
   - **GitHub 使用者名稱**：Repository Owner。
   - **GitHub Repository 名稱**：用來儲存 Vault 的 Repository。
   - **GitHub Branch**：例如 `main`。
3. **啟用同步**
   - 開啟後才會進行自動同步。
4. **同步大檔案**
   - **關閉（預設）**：跳過超過 10 MB 的檔案。
   - **開啟**：允許同步超過 10 MB 的檔案，最高 100 MB。
   - 大檔案在 Binary → Base64 編碼時會使用較多記憶體與網路流量，在 Android / iOS 上使用時需要特別注意。

## 🔄 手動同步

可以使用下列方式觸發完整雙向同步：

- 點擊 Obsidian 左側 Ribbon 的同步圖示。
- 開啟 Command Palette，執行「同步全部筆記」。
- 外掛啟動時也會自動執行一次完整同步。

完整同步流程為：

```text
GitHub → Pull 遠端變更
       ↓
比較 SHA / Hash
       ↓
本機 → Push 新增或修改的檔案
```

## ⚠️ 大檔案注意事項

「同步大檔案」不是 Git LFS。檔案仍透過 GitHub Contents API 直接以 Base64 傳輸，因此：

- GitHub API 單一檔案仍有大小限制。
- Base64 會增加傳輸資料量。
- 大型 PDF、影片、壓縮檔等會提高記憶體占用。
- 若需要同步非常大的檔案，建議改用 Git LFS、GitHub Release Assets 或其他專門的檔案儲存方案。

## ❓ 常見問題

同步機制、增量同步與衝突處理的詳細說明請參考 [FAQ](docs/FAQ.md)。

## 💖 Support / 支持

If this plugin has helped you with multi-device synchronization, please consider supporting the project. Your contribution keeps the development alive!

如果这个插件解决了您的多端同步需求，请考虑支持我一下。您的支持是持续开发的最大动力！

| Ko-fi (International / 国际) | WeChat (China / 微信支付) |
| :---: | :---: |
| [<img src="docs/images/kofi.png" height="36" alt="Buy Me a Coffee at ko-fi.com" />](https://ko-fi.com/thiter) | <img src="docs/images/qrcode.png" width="180" alt="WeChat Support" /> |

---

## 📄 License

MIT © [Thiter](https://github.com/thiter)
