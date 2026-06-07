# Decision: 完成 Svelte 5 标准宿主与组件接缝迁移

## 背景

`2026-04-03` 的决策把仓库从 Svelte 4 推进到 Svelte 5，但当时明确保留了 `compatibility.componentApi = 4`。那次选择解决的是依赖和编译器升级问题，没有完成宿主接缝和组件契约迁移。

随后这条技术债开始限制后续工作：

- `FolderCardView.ts` 仍依赖 `new / $on / $set / $destroy` 语义。
- 根面板和叶子组件仍带着 legacy props 和事件分发模式。
- 测试虽然能保住旧 seam，但对真实 Svelte 5 运行时覆盖不够。
- 文档和认知都停留在“兼容层过渡阶段”，这会误导后续实现继续围绕旧 seam 扩展。

## 触发信号

- `svelte-5-migration` 计划已经完成 Task 1 到 Task 9 与 Final Wave。
- 真实代码已经具备新的宿主边界和验证链路。
- 若文档还继续宣称项目依赖 compatibility mode，未来维护者和 AI 会在错误前提下继续改代码。

## 决策

我们将项目当前阶段正式定义为：**标准 Svelte 5 宿主与组件接缝已经完成，compatibility 过渡阶段结束。**

具体落点如下：

1. `FolderCardView.ts` 使用 `mount/unmount` 管理 `FolderCardPanel.svelte`，不再依赖 legacy class component API。
2. `src/view/panel-model.ts` 成为宿主持有的状态边界，替代旧的 `$set(...)` 推送。
3. `FolderCardPanel.svelte`、`Toolbar.svelte`、`CardItem.svelte` 已迁移到标准 Svelte 5 组件模式，使用 `$props()`、callback props 和 runes 相关用法。
4. `esbuild.config.mjs` 与 `vitest.config.ts` 不再启用 `compatibility.componentApi = 4`。
5. 仓库验证面正式分成 node 和 jsdom 两条 Vitest lane，并保留真实 `.svelte.test.ts` 运行时覆盖。
6. CI 以 Node 20 执行 `npx svelte-check --tsconfig ./tsconfig.json`、`npm run check`、`npm run build`、`npm test` 作为标准验证链路。

## 为什么选这个方向

### 1. 让当前架构说明和真实代码一致

如果文档继续把兼容层写成现状，后续实现会沿着已经废弃的 seam 继续堆积。现在需要把“过渡阶段已经结束”写成明确事实。

### 2. 把宿主状态和面板渲染边界固定下来

`panel-model` 不是临时包装层，而是迁移后的正式边界。它让宿主负责真值，面板负责订阅和交互，从而避免状态重新散回 Svelte 组件。

### 3. 让验证策略跟架构演进匹配

只保留 node lane 和 mock seam 已经不够。Svelte 5 迁移之后，真实 jsdom 运行时测试和 CI 必须成为正式约束，否则未来很容易在表面通过、运行时失真。

## 影响

### 正面影响

- 项目不再依赖 compatibility mode，可以按标准 Svelte 5 方式继续演进。
- 宿主与面板之间有了稳定的 `panel-model` 边界。
- 测试和 CI 对真实运行时的约束更强，回归风险更低。

### 结构性影响

- 后续所有视图变更都应默认遵守 `mount/unmount + panel-model + callback props` 接缝。
- 任何重新引入 legacy component API 语义的尝试，都应被视为架构回退，而不是普通实现选择。

## 成本与风险

1. 迁移完成后，测试面更多，维护成本比过去高一些。
2. `Toolbar.svelte` 仍有已知非阻塞 a11y warnings，这会继续出现在验证输出里。
3. 若未来有人跳过 `panel-model` 直接让组件持有宿主真值，边界会重新变脏。

## 备选方案

### 方案 A：继续把 compatibility mode 当成长期稳态

没有采用。这样会让文档、测试和代码长期背着过渡设计，后续功能也更容易继续依赖旧 seam。

### 方案 B：完成迁移，但不补真实运行时测试和 CI

没有采用。这样会让标准 Svelte 5 接缝缺少足够验证，无法支撑后续功能开发。

## 后续动作

1. 把后续功能重心放回批量操作、搜索、视觉和 a11y 收尾。
2. 在新增视图能力时优先扩展 `panel-model` 和 jsdom runtime tests。
3. 单独处理 `Toolbar.svelte` 的 a11y warnings，不要把它们和迁移完成状态混在一起。

## Supersedes / related records

- 相关记录：`docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- 这条记录不否定 `2026-04-03` 当时的阶段性决策，但它明确宣告该过渡阶段已经结束。
- 可视为对 `2026-04-03` 的后续收尾记录，以及对当前正式架构状态的补充。

## Related files

- `docs/START_HERE.md`
- `docs/architecture.md`
- `src/view/FolderCardView.ts`
- `src/view/panel-model.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
- `src/view/CardItem.svelte`
- `esbuild.config.mjs`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
