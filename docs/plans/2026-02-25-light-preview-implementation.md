# 轻量格式卡片预览 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在卡片预览中支持轻量 Markdown 格式（标题、列表、引用、粗斜体、行内代码），仅提取前 200 个可见字符，并按约定处理开头代码块/图片。

**Architecture:** 在 `markdown-utils.ts` 新增轻量预览构建器，采用单次线性扫描和受控 HTML 输出；在 `FolderCardView.ts` hydration 时写入 `previewHtml` 与 `previewMode`；在 `FolderCardPanel.svelte` 用 `{@html}` 渲染并区分代码/空预览状态；在 `styles.css` 增强字体与块级样式，同时限制预览区域高度以兼容虚拟列表固定高度假设。

**Tech Stack:** TypeScript (strict), Svelte 4, Obsidian Plugin API, esbuild

---

### Task 1: 扩展预览数据结构

**Files:**
- Modify: `src/view/types.ts`
- Modify: `src/view/FolderCardView.ts`

**Step 1: 先让类型检查失败（新增字段后未赋值）**

将 `NoteCardRecord` 增加字段：

```ts
previewHtml: string;
previewMode: "text" | "code" | "empty";
```

**Step 2: 运行类型检查验证失败**

Run: `npm run check`
Expected: FAIL，提示 `NoteCardRecord` 初始化缺少新字段

**Step 3: 在 `setFolder()` 初始化记录时补齐字段**

```ts
previewHtml: "",
previewMode: "empty",
```

**Step 4: 再次运行类型检查**

Run: `npm run check`
Expected: PASS（或仅剩后续任务引入的错误）

**Step 5: Commit**

```bash
git add src/view/types.ts src/view/FolderCardView.ts
git commit -m "refactor: extend card record for formatted preview state"
```

### Task 2: 实现轻量预览构建器

**Files:**
- Modify: `src/view/markdown-utils.ts`

**Step 1: 增加结果类型与主函数签名**

```ts
export interface LightPreviewResult {
  html: string;
  mode: "text" | "code" | "empty";
}

export function buildLightPreview(markdown: string, maxVisibleChars = 200, codePreviewLines = 4): LightPreviewResult {
  // implementation
}
```

**Step 2: 实现起始区规则（跳过空行/图片，处理开头代码块）**

- 跳过 `![]()`、`![[...]]`、`<img ...>` 行
- 若首个有效块为围栏代码块，抓取前 `codePreviewLines` 行并输出 `<pre><code>`

**Step 3: 实现正文轻量块级解析**

- 识别标题、列表、引用、段落
- 行内识别粗体、斜体、行内代码
- 链接保留可读文本，移除 URL

**Step 4: 实现 200 可见字符预算与截断**

- 小于 200：完整显示，不加 `...`
- 超过 200：在当前块安全截断并追加 `...`

**Step 5: 加入安全与性能护栏**

- 文本统一 HTML 转义
- 扫描上限（例如 400 行）

**Step 6: Commit**

```bash
git add src/view/markdown-utils.ts
git commit -m "feat: add lightweight markdown preview builder"
```

### Task 3: 接入 hydration 数据流

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: 替换旧提取逻辑**

将：

```ts
card.excerpt = stripMarkdownToText(markdown, 240);
```

替换为：

```ts
const preview = buildLightPreview(markdown, 200, 4);
card.previewHtml = preview.html;
card.previewMode = preview.mode;
card.excerpt = "";
```

**Step 2: 保持现有 generation / hydration 行为不变**

- 不改 `hydrateRange()` 调度策略
- 不改封面图提取策略

**Step 3: 运行类型检查**

Run: `npm run check`
Expected: PASS

**Step 4: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: hydrate cards with formatted preview payload"
```

### Task 4: 卡片视图渲染改造

**Files:**
- Modify: `src/view/FolderCardPanel.svelte`

**Step 1: 预览区域改为 HTML 渲染**

- `card.hydrated` 后按 `previewMode` 渲染
- `text/code` 模式使用 `{@html card.previewHtml}`
- `empty` 模式显示占位文案

**Step 2: 保留 loading 状态文案**

- 未 hydrated 时继续显示 `Loading preview...`

**Step 3: Commit**

```bash
git add src/view/FolderCardPanel.svelte
git commit -m "feat: render lightweight formatted previews in cards"
```

### Task 5: 样式增强与稳定性

**Files:**
- Modify: `styles.css`

**Step 1: 提升可读性**

- 调整 `fce-excerpt` 字号和行高
- 增加标题、列表、引用、行内代码、代码块样式

**Step 2: 控制卡片高度波动**

- 给预览区域设置最大高度与隐藏溢出
- 防止虚拟列表固定高度假设被破坏

**Step 3: Commit**

```bash
git add styles.css
git commit -m "style: improve preview typography and formatted block styles"
```

### Task 6: 最终验证

**Files:**
- No code changes expected

**Step 1: 类型检查**

Run: `npm run check`
Expected: PASS

**Step 2: 构建验证**

Run: `npm run build`
Expected: PASS，生成 `main.js`

**Step 3: 手工场景验证（Obsidian 内）**

- 开头代码块：显示前 4 行代码
- 开头图片：跳过图片后显示正文
- 文本 < 200：完整显示无 `...`
- 文本 > 200：截断并带 `...`

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add lightweight formatted 200-char card previews"
```
