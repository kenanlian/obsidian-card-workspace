# Decision: 迁移到 Svelte 5，但保留 legacy component API 宿主兼容层

## 背景

项目的视图层一直建立在 Svelte 4 之上，但它并不是一个“纯前端应用”。`FolderCardView.ts` 作为 Obsidian `ItemView` 的运行时中枢，直接以类组件方式管理 `FolderCardPanel.svelte`：

- `new FolderCardPanel({ target, props })`
- `component.$on(...)`
- `component.$set(...)`
- `component.$destroy()`

这套接入方式不仅存在于运行时代码，也被测试 mock 和事件契约测试显式依赖。

与此同时，Svelte 5 已经成为当前主版本。继续停留在 Svelte 4 会让依赖和工具链逐步陈旧，但如果把这次升级同时做成“runes 重写 + callback props 改造 + 宿主挂载方式重做”，风险会明显放大。

## 触发信号

- 仓库依赖仍停留在 `svelte@^4.2.20`
- `FolderCardView.ts` 与相关测试显式依赖 Svelte 4 类组件 API
- 需要升级到 Svelte 5，但用户并没有要求同时重构整个视图层编程模型

## 决策

我们将本次迁移定义为：

1. **升级到 Svelte 5 和 Svelte 5 兼容的 `esbuild-svelte` 版本**。
2. **在编译配置中启用 `compatibility.componentApi = 4`**，继续兼容现有 `new / $on / $set / $destroy` 宿主接口。
3. **本次不把 `.svelte` 组件源码改写为 runes / `$props` / callback props 模式**。
4. **后续若要移除 compatibility 层，必须作为单独的结构性任务处理**。

## 为什么选这个方向

### 1. 把升级风险限制在依赖与编译边界

这次真正需要解决的问题是“项目从 Svelte 4 升到 Svelte 5”。启用兼容层后，可以先把风险集中在依赖和构建配置，不把宿主接入面、组件事件协议和测试 seam 一起改掉。

### 2. 保持 Obsidian 宿主集成稳定

这个插件不是靠浏览器入口文件挂载，而是由 `FolderCardView.ts` 在 Obsidian 生命周期中动态创建/销毁视图。保住类组件 API，可以避免把宿主集成与 UI 语法迁移耦合成一次大手术。

### 3. 给后续 runes 迁移留出明确边界

未来若要把组件改成 `$props()`、callback props、`$state` / `$derived` / `$effect`，应该先明确新的组件通信协议和测试策略，再逐个组件迁移。这样更容易验证，也更容易回退。

## 影响

### 正面影响

- 项目依赖进入 Svelte 5 主线，避免继续锁死在旧版本
- 现有宿主接入与测试 seam 可以保持不变
- 迁移 diff 小，验证范围清晰

### 结构性影响

- 当前代码库会处于“**Svelte 5 运行时 + legacy 组件语法/接口**”状态
- 文档必须明确说明：这不是 runes 迁移完成，而是第一阶段

## 成本与风险

1. **兼容层是过渡方案，不是终局。** 它降低了本次升级风险，但也意味着后续仍有一次源码级迁移任务。
2. **团队可能误以为已经完成 Svelte 5 全量迁移。** 因此必须在文档里明确写出当前仍依赖 compatibility 模式。
3. **后续功能开发若顺手混入 runes 改写，容易形成半新半旧的混合状态。** 需要把这类演进保持为明确的独立任务。

## 备选方案

### 方案 A：一次性把全部组件和宿主接入改成 Svelte 5 新 API

没有采用。这样理论上更“彻底”，但会把依赖升级、组件事件协议改写、宿主挂载方式变更、测试重写压缩到一次提交里，失败面太大。

### 方案 B：继续停留在 Svelte 4

没有采用。这样会让依赖与构建链路继续老化，也会推迟必然要做的升级工作。

## 后续动作

1. 在后续独立任务中评估 runes 迁移的真实收益与成本。
2. 如果开始源码级迁移，优先从 `CardItem.svelte`、`Toolbar.svelte`、`FolderCardPanel.svelte` 的 props / 事件协议设计入手。
3. 在移除 compatibility 层之前，先重新设计 `FolderCardView.ts` 与组件之间的宿主接入 seam。

## Supersedes / related records

- 不覆盖已有决策记录；这是一次工具链与宿主兼容策略的新增决策。
- 相关记录：`docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`

## Related files

- `package.json`
- `esbuild.config.mjs`
- `src/view/FolderCardView.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
- `src/view/CardItem.svelte`
- `src/__mocks__/FolderCardPanel.svelte.ts`
