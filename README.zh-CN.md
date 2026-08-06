# Card Workspace

[English](README.md)

一个 Obsidian 插件：在边栏或主编辑区中以卡片流展示文件夹里的笔记。你可以手动打开 Card Workspace，按文件夹浏览笔记，使用标签筛选，使用插件内置搜索，并使用多种方式打开卡片笔记。

![Card Workspace 演示](screenshots/2026_08_06_09_24_27.jpg)

> ## 1.0.0 重点更新
>
> **双栏侧边栏布局。** Card Workspace 现在会在卡片流旁边渲染自带的导航栏，文件夹、标签、卡片盒和收藏都只需一次点击即可切换，不再需要借用 Obsidian 的文件浏览器。你可以拖动中间的分隔条调整导航栏宽度，或用标题栏的切换按钮把它收起来，让卡片占满整个宽度。当侧边栏宽度不足以容纳两栏时，布局会自动降级为单栏，此时该切换按钮会在导航栏和卡片流之间切换，因此面板在任何宽度下都可用。
>
> **卡片盒。** 卡片盒是保存在导航栏 **Boxes** 区的主题式集合。在该区域右键即可新建，也可以一步把当前的「文件夹 + 标签」浏览范围保存为一个卡片盒。每个卡片盒都有自己的归属规则（文件夹范围加标签，多条规则之间是 OR 关系）、自己的排序和自己的置顶，并且支持手动加入或排除单篇笔记。用它可以把概念上相关、但分散在不同文件夹里的笔记聚到一起，而不必移动文件，也不必维护索引笔记。

## 目录

- [为什么选择 Card Workspace](#为什么选择-card-workspace)
- [安装](#安装)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [兼容性与限制](#兼容性与限制)
- [隐私](#隐私)
- [开发](#开发)
- [发布](#发布)
- [支持与许可证](#支持与许可证)

## 为什么选择 Card Workspace

Card Workspace 提供了一种更直观、可快速扫描的方式，用来浏览和整理任意文件夹中的笔记。你不再只是面对一份普通的文件列表，而是能看到带有标题和摘要的卡片。选择文件夹和标签、扫一眼卡片，再打开你想看的笔记，同时不会丢失当前位置。

## 安装

Card Workspace 目前支持通过 GitHub Releases 手动安装。

1. 前往 [Releases](https://github.com/kenanlian/obsidian-card-workspace/releases) 页面下载最新版本。
2. 解压压缩包，并将 `main.js`、`manifest.json` 和 `styles.css` 复制到你的仓库目录 `.obsidian/plugins/card-workspace/` 中。
3. 打开 Obsidian 的 **设置 -> 第三方插件**。
4. 如果 **安全模式** 处于开启状态，请先关闭。
5. 在插件列表中找到 **Card Workspace** 并启用它。

## 快速开始

1. 从 Obsidian 命令面板运行 **Open Card Workspace view**，或点击左侧 ribbon 图标，在**左侧边栏**打开该面板。
2. 在 Card Workspace 自带的导航栏中选择文件夹、标签或卡片盒。
3. 浏览卡片流，并点击任意卡片打开对应笔记。
4. 右键文件夹、标签、卡片盒或卡片可使用其余操作；把卡片拖入已打开的编辑器即可插入对应链接。

## 功能特性

- **左侧边栏文件夹浏览。** 在左侧边栏打开 Card Workspace 后，可按文件夹浏览对应的卡片流。
- **双栏导航面板。** 卡片流左侧是一栏宽度可调的导航栏，无需离开面板即可切换文件夹、标签、卡片盒和收藏。
- **卡片盒。** 可把「文件夹 + 标签」的浏览范围保存为可复用的规则集合，并为它单独设置名称和排序；也可以一步把当前范围或当前视图加入某个卡片盒。
- **收藏。** 可把常用的文件夹、文件、标签和卡片盒放进独立的收藏区，按类型分组并支持调整顺序。
- **完整右键菜单。** 在导航栏或卡片上右键即可新建笔记、文件夹、白板和 Base，重命名、复制、移动、删除，复制仓库路径或系统路径，在系统文件管理器中定位，以及在指定文件夹内搜索。
- **拖拽插入。** 把卡片拖入已打开的编辑器，可插入 wikilink、嵌入、笔记正文，或「标题 + 正文」；也可以设置为每次拖放时询问使用哪一种。
- **卡片预览。** 每张卡片都会显示笔记标题，以及去除 Markdown 格式后的摘要内容。
- **虚拟化滚动。** 即使文件夹很大，也能保持流畅，因为只会渲染当前可见的卡片。
- **双向同步。** 点击卡片可打开对应笔记；在编辑器中切换笔记时，对应卡片也会自动选中。
- **本地搜索。** 可在当前文件夹的卡片范围内进行全文搜索。
- **标签筛选。** 可按 frontmatter 和笔记正文中提取出的标签过滤卡片。
- **置顶重排。** 可将卡片置顶，让它们始终显示在卡片流顶部。
- **批量操作。** 可同时选择多张卡片，批量移动、删除或合并笔记。

## 兼容性与限制

- **仅支持桌面端。** Card Workspace 依赖桌面端的左侧边栏工作流，移动端不可用。
- **Obsidian 版本要求。** 需要 Obsidian 1.9.0 或更高版本，因为卡片对 Bases 的支持依赖该版本。实际行为和兼容性以 `manifest.json` 中声明的内容为准。

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
   npm run release:prepare -- "$TAG" 1.9.0
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
