# Card Workspace

[English](README.md)

一个 Obsidian 插件：在左侧边栏中以温暖复古风卡片流展示文件夹里的笔记。你可以手动打开 Card Workspace，按文件夹浏览笔记，点击卡片打开笔记，也可以按需把文件浏览器中的文件夹点击联动到这个视图里。

## 目录

- [为什么选择 Card Workspace](#为什么选择-card-workspace)
- [安装](#安装)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [预览内容](#预览内容)
- [兼容性与限制](#兼容性与限制)
- [隐私](#隐私)
- [开发](#开发)
- [发布](#发布)
- [支持与许可证](#支持与许可证)

## 为什么选择 Card Workspace

Card Workspace 提供了一种更直观、可快速扫描的方式，用来浏览和整理任意文件夹中的笔记。你不再只是面对一份普通的文件列表，而是能看到带有标题和摘要的卡片。选择文件夹和标签、扫一眼卡片，再打开你想看的笔记，同时不会丢失当前位置。

## 安装

Card Workspace 目前通过 GitHub Releases 手动安装。

1. 前往 [Releases](https://github.com/kenanlian/obsidian-card-workspace/releases) 页面下载最新版本。
2. 解压压缩包，并将 `main.js`、`manifest.json` 和 `styles.css` 复制到你的仓库目录 `.obsidian/plugins/card-workspace/` 中。
3. 打开 Obsidian 的 **设置 -> 第三方插件**。
4. 如果 **安全模式** 处于开启状态，请先关闭。
5. 在插件列表中找到 **Card Workspace** 并启用它。

## 快速开始

1. 从 Obsidian 命令面板运行 **Open Card Workspace view**，在**左侧边栏**打开该面板。
2. 在 Card Workspace 中浏览笔记，并点击任意卡片打开对应笔记。
3. 如果你希望文件浏览器中的文件夹点击也自动跳转到 Card Workspace，可在插件设置中启用 **Link File Explorer folder clicks to Card Workspace**。
4. 当你在编辑器中切换笔记时，对应卡片也会自动被选中。

## 功能特性

- **左侧边栏文件夹浏览。** 在左侧边栏打开 Card Workspace 后，可按文件夹浏览对应的卡片流。
- **可选的文件浏览器联动。** 启用后，在文件浏览器中点击文件夹时，也会在 Card Workspace 中打开该文件夹。
- **卡片预览。** 每张卡片都会显示笔记标题，以及去除 Markdown 格式后的摘要内容。
- **虚拟化滚动。** 即使文件夹很大，也能保持流畅，因为只会渲染当前可见的卡片。
- **双向同步。** 点击卡片可打开对应笔记；在编辑器中切换笔记时，对应卡片也会自动选中。
- **本地搜索。** 可在当前文件夹的卡片范围内进行全文搜索。
- **标签筛选。** 可按 frontmatter 和笔记正文中提取出的标签过滤卡片。
- **置顶重排。** 可将卡片置顶，让它们始终显示在卡片流顶部。
- **批量操作。** 可同时选择多张卡片，批量移动、删除或合并笔记。
- **温暖复古风格。** 通过 `styles.css` 提供带有纸质质感的卡片界面风格。

## 预览内容

卡片会显示笔记标题以及去除 Markdown 格式后的摘要。摘要从笔记正文中生成，并移除图片和格式标记，以提升可读性。

## 兼容性与限制

- **仅支持桌面端。** Card Workspace 依赖桌面端的文件浏览器和左侧边栏工作流，移动端不可用。
- **以侧边栏为主的工作流。** Card Workspace 作为左侧边栏视图始终可用，而文件浏览器文件夹点击联动是可选项，且默认关闭。
- **Obsidian 版本要求。** 需要 Obsidian 1.5.0 或更高版本。实际行为和兼容性以 `manifest.json` 中声明的内容为准。

## 隐私

所有处理都在你的本地仓库内完成。该插件不会发起外部网络请求。文件操作通过 Obsidian 本地的 Vault 和 FileManager API 完成，搜索索引使用本地 `minisearch` 库。

## 开发

```bash
npm install
npm run build
```

如需启用 watch 模式：

```bash
npm run dev
```

运行类型检查和测试：

```bash
npm run check
npm test
```

## 发布

此仓库通过 `.github/workflows/release.yml`，基于纯 semver 标签自动创建 GitHub Draft Release。

1. 从 `manifest.json` 中确定目标版本：

   ```bash
   TAG=$(node -p "require('./manifest.json').version")
   ```

2. 同步发布元数据：

   ```bash
   npm run release:prepare -- "$TAG"
   ```

   如果还需要同时提升最低支持的 Obsidian 版本，可将它作为第二个参数传入：

   ```bash
   npm run release:prepare -- "$TAG" 1.6.0
   ```

3. 运行常规检查以及发布校验：

   ```bash
   npm run check:svelte
   npm run check
   npm run build
   npm test
   npm run release:check -- "$TAG"
   ```

4. 提交版本变更，然后创建并推送一个带注释的纯 semver 标签，该标签必须与 `manifest.json.version` 完全一致（例如 `<version>`，而不是 `v<version>`）：

   ```bash
   git tag -a "$TAG" -m "$TAG"
   git push origin main
   git push origin "$TAG"
   ```

5. 工作流会创建一个包含 `main.js`、`manifest.json` 和 `styles.css` 的 GitHub Draft Release。
6. 在 GitHub 上补充发布说明，并发布该 Draft Release。

## 支持与许可证

如果你遇到问题，请前往 [GitHub Issues](https://github.com/kenanlian/obsidian-card-workspace/issues) 提交 issue。

Card Workspace 采用 MIT License 发布。
