- [x] Task 1. [P0] 建立统一设置与持久化层（排序、筛选、是否递归子文件夹、默认视图等）——先把状态模型定住，后续功能不反复返工。
- [x] Task 2. [P0] 搭建顶部操作栏骨架（按钮区 + 内容区，贴近官方插件布局）——给"选文件夹/新建/排序/筛选/批量"提供统一入口，避免后期 UI 重构。
- [x] Task 3. [P0] 修复"开头代码块最后一行被裁切"问题——先清掉已知显示 bug，提升可用性和信任感。
- [x] Task 4. [P0] 增加"同一文件夹重复点击短路"与重复渲染防抖——直接减少无效计算，立即见效。
- [x] Task 5. [P0] 修复虚拟滚动固定高度与动态内容高度不一致（你漏掉项）——避免滚动跳动、错位、白屏区等结构性问题。
- [x] Task 6. [P0] 优化大列表渲染路径（减少整数组复制、批量更新、限制并发 hydration）（你漏掉项）——降低上千条时卡顿和 GC 压力。
- [x] Task 7. [P0] 从"整文件夹重建"升级为"增量刷新"（你漏掉项）——文件增删改时只更新受影响卡片，性能和响应都更稳。
- [x] Task 8. [P1] 面板内文件夹选择（不再依赖文件管理器点击）——插件独立性更强，交互更闭环。
- [x] Task 9. [P1] "全部笔记"视图——覆盖全局浏览场景，提升插件主入口价值。
- [x] Task 10. [P1] 在当前文件夹新建笔记——形成"看卡片→立刻创建"的完整工作流。
- [x] Task 11. [P1] 排序（ctime/mtime + 正序/倒序）——满足最基础的信息检索习惯。

---

## Phase 3 — 管线骨架 + 独立功能（并行开发）

> **目标**：搭建筛选管线、同时交付 4 个互相独立的功能。管线和独立任务无依赖关系，可完全并行。
> **预估总工期**：3–5 天（并行推进）

### 3A：管线骨架（阻塞后续筛选/置顶/搜索）

- [x] Task 12. [P1] `deriveVisibleCards()` 筛选管线——将 `deriveVisibleCards()` 从 stub 改造为同步链式投影：`baseCards → tag filter → search filter (optional) → pin reorder → visibleCards`。**保持最小化**：定义清晰的步骤接口，各步骤为纯函数；无 filter 激活时 = pass-through，行为不变。
  - **前置**：无（当前 L835 已有 stub）
  - **产出**：管线骨架 + 步骤类型定义；现有行为不变
  - **工作量**：0.5–1 天

### 3B：独立功能（与 3A 并行，互相无依赖）

- [ ] Task 13. [P1] 子文件夹包含开关——`includeSubfolders` 设置已存在并在 `collectMarkdownFiles()` 数据采集层生效。仅需：(1) Toolbar 添加 UI 开关；(2) 切换后调用 `refresh()` 重新采集。**注意**：此功能作用于数据采集层而非管线，不依赖 T12。
  - **前置**：无
  - **产出**：Toolbar 开关 + 设置持久化 + 卡片列表响应
  - **工作量**：0.5 天

- [x] Task 15. [P1] 单条笔记移动——`note-ops.ts` 中 `moveFile()` 已实现。需：(1) 卡片右键菜单或操作按钮；(2) `FolderPickerModal` 选择目标文件夹；(3) 调用 `moveFile()` 后增量刷新卡片列表。
  - **前置**：无
  - **产出**：右键菜单 "Move to…" + FolderPickerModal 联动 + 增量刷新
  - **工作量**：1–1.5 天

- [x] Task 16. [P1] 复制"标题 + 全文"——`note-ops.ts` 中 `copyNoteToClipboard()` / `buildClipboardText()` 已实现，仅需在卡片右键菜单或操作栏添加入口。
  - **前置**：无
  - **产出**：右键菜单 "Copy" + 复制成功 toast
  - **工作量**：0.5 天

- [ ] Task 18. [P2] 批量选中框架（多选状态、快捷键、工具栏联动）——需：(1) 基于**文件路径**的 `Set<string>` 选中状态管理（不用数组下标，避免排序/筛选后漂移）；(2) `CardItem.svelte` 添加 checkbox；(3) Shift+Click 范围选中；(4) Toolbar 批量模式切换 + 全选/取消；(5) 选中计数显示。
  - **前置**：无
  - **产出**：多选 UI + 状态管理 + 键盘快捷键
  - **工作量**：2–3 天

---

## Phase 4 — 管线依赖功能 + 批量操作

> **目标**：管线就绪后，接入标签筛选和置顶；批量框架就绪后，接入批量动作。
> **预估总工期**：4–6 天

### 4A：管线依赖（需 T12 完成）

- [x] Task 14. [P1] 标签筛选——后端 `matchesTagFilter()`、`collectAllTags()`、`getFileTags()` 均已实现，仅需：(1) Toolbar filter 按钮展开标签选择 UI；(2) 将选中标签写入 `settings.filter.tags`；(3) 在管线中接入 `matchesTagFilter()`。标签不纳入 MiniSearch 索引——metadata 层面过滤更快且语义明确。
  - **前置**：Task 12（管线中 tag filter 步骤）
  - **产出**：标签选择面板 + 管线接入 + 设置持久化
  - **工作量**：1–2 天

- [x] Task 17. [P2] 置顶能力（含持久化策略）——需：(1) `PluginSettings` 增加 `pinnedPaths: string[]` 字段；(2) `NoteCardRecord` 增加 `pinned` 计算属性；(3) 管线中 pin reorder 步骤（置顶卡片排在最前）；(4) 卡片 UI 上的 pin/unpin 按钮。**设计约束**：置顶只影响排序，不绕过筛选——被 tag filter 过滤掉的置顶笔记仍然隐藏。
  - **前置**：Task 12（管线中 pin reorder 步骤）
  - **产出**：pin/unpin 交互 + 持久化 + 管线集成
  - **工作量**：1–2 天

### 4B：批量操作（需 T18 完成）

- [ ] Task 19. [P2] 批量移动/删除（含确认、错误回滚、与 Obsidian 回收机制对齐）——`note-ops.ts` 中 `batchMoveFiles()` / `batchTrashFiles()` / `batchDeleteFiles()` 已实现。需：(1) 确认 Modal（"将移动/删除 N 个文件"）；(2) 进度反馈；(3) 错误收集与报告；(4) 操作完成后清空选中状态 + 增量刷新。
  - **前置**：Task 18（批量选中框架）
  - **产出**：批量移动 + 批量删除 + 确认 Modal + 错误处理
  - **工作量**：2–3 天

- [ ] Task 20. [P3] 批量合并笔记——`note-ops.ts` 中 `mergeNotes()` 已实现。需：(1) 合并顺序配置 UI；(2) 分隔符设置；(3) 合并预览；(4) 确认 Modal。
  - **前置**：Task 18（批量选中框架）
  - **产出**：合并 UI + 预览 + 确认 + 错误处理
  - **工作量**：2–3 天

---

## Phase 5 — Plan E 搜索（IndexedDB 持久化全文索引）

> **决策记录**：用户选定方案 E（IndexedDB 持久化 + MiniSearch），目标支持 10000+ 文件全库搜索。
> **目标环境**：仅桌面端（Electron）。Electron 使用 Chromium IndexedDB，始终可用，配额约为磁盘 60%，对搜索索引来说基本无限。无需考虑移动端兼容性。
> **预估总工期**：6–10 天

### 搜索库选型决策（调研结论）

> **结论**：维持 MiniSearch 方案。以下为候选库对比及决策依据。

**候选库评分矩阵**（1-5 分，越高越好）：

| 维度 | MiniSearch | FlexSearch | Orama | Lunr.js | Fuse.js |
|---|:---:|:---:|:---:|:---:|:---:|
| 架构适配 | 5 | 4 | 4 | 2 | 1 |
| 性能 | 4 | 5 | 4 | 2 | 1 |
| 健壮性 | 5 | 3 | 4 | 3 | 4 |
| CJK 支持 | 2 | 4 | 3 | 2 | 2 |
| 生态适配 | 5 | 2 | 3 | 2 | 3 |
| **总分** | **21** | **18** | **18** | **11** | **11** |

**淘汰库及原因**：
- **Stork / Pagefind / TinySearch**：静态站点工具，需 CLI 预构建索引 + WASM runtime，不适合运行时动态索引
- **Elasticlunr**：2016 年最后发布，实质已弃
- **Lunr.js**：2020 年最后发布，索引构建后实质只读，不支持增量 add/remove/update
- **Fuse.js**：模糊匹配器而非全文搜索引擎，无倒排索引；`parseIndex()` 仍需原始文档列表在内存中

**MiniSearch 胜出原因**：
- 序列化一流：`toJSON()` → 单个 JSON 对象 → `JSON.stringify()` → IndexedDB；反序列化用 `MiniSearch.loadJSONAsync()` 异步分批加载，不阻塞主线程
- 增量操作完整：`add()`, `remove()`, `replace()`, `discard()`, `addAllAsync()`（协作式分批，不阻塞 UI）
- Bundle 极小：17.8 KB min / 5.95 KB gzip（FlexSearch 50.8 KB / 17.5 KB，Orama 78.7 KB / 25.4 KB）
- Obsidian 生态验证：Omnisearch（最流行的 Obsidian 搜索插件）+ obsidian-copilot 均使用 MiniSearch
- 序列化输出包含 `serializationVersion`，方便版本迁移

**FlexSearch 落选原因**（性能最强但序列化不可靠）：
- `export()/import()` 是回调式 API，已知 bug：大索引抛 `RangeError: Invalid string length`
- `Document` 索引 + `enrich: true` 导入后 `doc` 为 undefined
- Persistent Index 和 Worker Index 不支持 export/import（官方文档明确说明）
- `serialize()` 标记为 experimental，仅推荐小索引
- Obsidian 生态零验证

**Orama 落选原因**（现代化但过重）：
- Bundle 是 MiniSearch 的 4 倍+
- 核心包 + tokenizer 包 + persistence 插件 = 3 个依赖
- 韩文 tokenizer 标注为 "work in progress"
- 对于纯全文搜索场景，多数能力（向量搜索、facets）是 overhead

**升级触发条件**：
- 如果 T21 spike 发现 MiniSearch 在 10k 文件下 `loadJSONAsync()` 冷启动 > 3s 或查询延迟可感知 → 考虑 FlexSearch
- 如果未来需要向量搜索、facets 等高级功能 → 考虑 Orama

### CJK 分词策略

> **适用于所有搜索库的通用策略，与库选型无关。**

1. **使用 `Intl.Segmenter`**——Electron/Chromium 原生支持，无需额外依赖：
   ```ts
   // zh / ja / ko 均可使用同一模式
   const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
   ```
2. **索引和查询必须使用同一个 tokenizer**——不匹配是 CJK 搜索 bug 的首要原因。将自定义 tokenizer 同时传入 MiniSearch 的 `tokenize`（索引时）和 `searchOptions.tokenize`（查询时）。
3. **Tokenizer 独立版本管理**——分词逻辑变更时自动作废持久化索引并触发全量重建。IndexedDB 元数据中存储 `tokenizerVersion` 字段。
4. **混合脚本处理**：CJK span 用 `Intl.Segmenter`，Latin span 用默认空格分词。参考 Omnisearch 实现：检测 CJK regex → 调用 segmenter，否则走默认路径。
5. **召回率不足时的备选**：对 CJK span 生成重叠 bigram（仅 CJK 字符，不影响 Latin 文本），控制索引膨胀。
6. **参考实现**：Omnisearch 的 `src/search/tokenizer.ts` 中 `tokenizeChsWord()` 方法使用独立中文分词插件 + `segmenter.cut(word, { search: true })`。Orama 的 `@orama/tokenizers` 中 Japanese/Mandarin tokenizer 底层也是 `Intl.Segmenter`。

### 5A：技术验证 + 契约层

> **注意**：T21 可在 Phase 3 期间提前并行启动，不必等到 Phase 4 完成。

- [ ] Task 21. [P2] Plan E 桌面端集成验证（Spike）——在独立分支上验证关键风险点（**不再测试 IDB 可用性和大小限制**，桌面端 Electron 已确认无问题）：
  1. MiniSearch `toJSON()` / `MiniSearch.loadJSON()` 序列化体积（以 1000/5000/10000 文件为基准）
  2. 索引构建耗时（`vault.cachedRead()` 全量读取 + MiniSearch `addAll()`）
  3. 序列化 JSON 写入 IndexedDB 的耗时
  4. `MiniSearch.loadJSONAsync()` 冷启动加载耗时
  5. 每个 Vault 的命名空间隔离策略（参考 `app.appId`）
  6. Schema 版本管理与损坏恢复策略
  - **产出**：spike 报告 + 性能基准数据 + go/no-go 决策。如果 spike 结果不佳，回退到方案 C/D。
  - **前置**：无（可在 Phase 3 期间并行启动）
  - **工作量**：1–2 天

- [ ] Task 22. [P2] SearchService 契约层——定义 `SearchService` 接口：`query(text) → { paths: Set<string>, status: 'ready' | 'building' | 'failed', generation }` + 事件通知（`'index-ready'`, `'index-error'`）。实现一个 `NullSearchService`（pass-through，搜索未激活时使用），确保管线在无搜索时行为不变。
  - **前置**：Task 12（管线架构），Task 21（spike 通过）
  - **产出**：`SearchService` 接口 + `NullSearchService` 实现 + 类型定义
  - **工作量**：0.5–1 天

### 5B：存储与索引（T23 和 T24 可并行）

- [ ] Task 23. [P2] IndexStore——IndexedDB 存储层。封装 IndexedDB 操作：`open(dbName, version)`、`saveIndex(json, buildMeta)`、`loadIndex()`、`clear()`。包含 schema 版本管理（版本不匹配时自动清空重建）。不直接依赖 MiniSearch——只存/取序列化后的 JSON + 元数据。使用 `app.appId` 实现 per-vault 命名空间。
  - **前置**：Task 21（spike 确认方案可行）
  - **产出**：`IndexStore` 类 + 单元测试 + 版本迁移逻辑
  - **工作量**：1–2 天

- [ ] Task 24. [P2] MiniSearch 索引管理器——封装 MiniSearch 配置（fields: `[title, content]`，storeFields，tokenizer，fuzzy/prefix 参数）、`buildFromFiles(files)`、`serialize()` / `deserialize(json)`、`addDoc` / `removeDoc` / `replaceDoc` 增量操作。
  - **前置**：Task 21（spike 确认 MiniSearch 适用）
  - **产出**：`SearchIndexManager` 类 + 单元测试
  - **工作量**：1–2 天

### 5C：构建与集成

- [ ] Task 25. [P2] 首次索引构建 & 增量更新——(1) 首次构建：`app.workspace.onLayoutReady` 后调度后台任务，使用 `vault.cachedRead()` 逐文件读取，支持取消（generation 检查），构建完成后通过 `IndexStore` 持久化；(2) 增量更新：hook 现有 vault `create`/`modify`/`delete`/`rename` 事件（已有 debounce ~250ms），增量更新 MiniSearch 文档 + 定期持久化。**注意**：`vault.on('create')` 在启动期间会对所有已有文件触发，必须在 `onLayoutReady` 之后注册（参考 Omnisearch 实践）。增量更新前用 mtime 守卫避免重复工作；(3) 后续启动：从 IndexedDB 通过 `MiniSearch.loadJSONAsync()` 异步加载索引（避免阻塞主线程） → 对比 vault 文件 mtime → 只更新变化文件。
  - **前置**：Task 23（IndexStore），Task 24（MiniSearch 管理器）
  - **产出**：后台构建任务 + 增量更新逻辑 + 启动加载 + 持久化策略
  - **工作量**：2–3 天

### 5D：健康检测与搜索 UI（T26 和 T27 可并行）

- [ ] Task 26. [P2] 索引健康检测 & 重建——(1) 加载失败 / 版本不匹配 / 反序列化异常 → 自动清空 IndexedDB → 触发全量重建；(2) 用户手动 "Rebuild search index" 命令（注册 Obsidian Command）；(3) 状态上报到 `SearchService`（`'building'` / `'ready'` / `'failed'`）；(4) 设置面板中显示索引状态（文件数、最后构建时间、占用空间）。
  - **前置**：Task 25（构建 & 增量逻辑）
  - **产出**：健康检测 + 自动重建 + 手动重建命令 + 状态面板
  - **工作量**：1–2 天
  - **注意**：已移除移动端 flush 缓解措施（`navigator.storage.persist()`、`onunload` best-effort flush），仅桌面端无此风险

- [ ] Task 27. [P2] 搜索 UI 集成——(1) Toolbar 添加搜索输入框（debounce 300ms）；(2) `deriveVisibleCards()` 管线中接入 `SearchService`：当搜索激活时，用 `SearchService.query()` 返回的 `paths` 集合过滤卡片；(3) 索引未就绪时降级到 `matchesSearchQuery()`（simple includes）并显示"索引构建中"提示；(4) 搜索结果按 MiniSearch score 排序（覆盖默认排序）。**设计决策**：搜索关键词为视图级临时状态，不持久化到设置。
  - **前置**：Task 22（SearchService 契约），Task 25（构建完成才有数据），Task 12（管线架构）
  - **产出**：搜索输入框 + 管线集成 + 降级逻辑 + 排序
  - **工作量**：1–2 天

---

## Phase 6 — 视觉打磨 & 可访问性（P3 收尾）

> **预估总工期**：4–6 天

- [ ] Task 28. [P3] 背景/层级与官方视觉一致化——统一感增强，但不应早于核心可用性。
  - **前置**：所有功能性 Task 完成
  - **工作量**：1–2 天

- [ ] Task 29. [P3] 卡片外观微调（圆角、阴影、hover、选中）——体验加分项，适合功能稳定后再精修。
  - **前置**：Task 28
  - **工作量**：1 天

- [ ] Task 30. [P3] 文案本地化与可访问性（键盘导航/ARIA）——提升长期可维护性和可用人群覆盖。
  - **前置**：所有 UI 功能完成（确保所有待翻译文案已稳定）
  - **工作量**：2–3 天

---

## 依赖关系总览

```
T12 (管线骨架)
 ├── T14 (标签筛选)
 ├── T17 (置顶)
 └── T27 (搜索 UI 集成)

T13 (子文件夹开关) ← 独立（作用于数据采集层，不依赖管线）
T15 (单条移动)     ← 独立
T16 (复制)         ← 独立

T18 (批量选中框架) ← 独立（选中状态基于文件路径，不受排序/筛选影响）
 ├── T19 (批量移动/删除)
 └── T20 (批量合并)

T21 (Plan E Spike) ← 独立，可在 Phase 3 期间提前启动
 └── T22 (SearchService 契约) ← 也依赖 T12
 ├── T23 (IndexStore)     ┐
 └── T24 (MiniSearch 管理器) ┘ 可并行
      └── T25 (构建 & 增量)
           ├── T26 (健康 & 重建)  ┐
           └── T27 (搜索 UI)     ┘ 可并行

T28 (视觉一致化) → T29 (卡片微调) → T30 (i18n & a11y)
```

## 推荐 Phase 开发顺序

| Phase | 任务 | 并行关系 | 预估工期 |
|---|---|---|---|
| **Phase 3** | T12 + T13, T15, T16, T18 | 3A(T12) 与 3B(T13/T15/T16/T18) 完全并行；T21 spike 可提前启动 | 3–5 天 |
| **Phase 4** | T14, T17 + T19, T20 | 4A(T14/T17) 与 4B(T19/T20) 并行 | 4–6 天 |
| **Phase 5** | T21→T22→(T23∥T24)→T25→(T26∥T27) | T23/T24 并行；T26/T27 并行 | 6–10 天 |
| **Phase 6** | T28→T29→T30 | 串行 | 4–6 天 |

> **总预估工期**：17–27 天（单人）

---

## Plan E 参考实现（调研结果）

实现 Plan E 时可参考以下开源项目：

| 项目 | 模式 | 参考价值 |
|---|---|---|
| [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | Dexie + MiniSearch `toJSON()` / `loadJSONAsync()` | **首选参考**：生产级 IndexedDB 缓存、`onLayoutReady` 注册增量监听、异步加载避免阻塞 |
| [Smart2Brain](https://github.com/your-papa/obsidian-Smart2Brain) | 原生 IndexedDB + `JSON.stringify(miniSearch)` + `loadJSON()` | 轻量 IDB 封装、mtime 守卫避免重复索引 |
| [obsidian-database-library](https://github.com/Fevol/obsidian-database-library) | localforage (IndexedDB driver) + debounced flush | 通用 IDB 库模式、per-vault 命名 `<dbName>/<appId>` |

**关键技术点**：
- 序列化用 `MiniSearch.toJSON()` → 存入 IDB；反序列化用 `MiniSearch.loadJSONAsync()` (非 `loadJSON`，避免阻塞主线程)
- `vault.on('create')` 启动期间对所有已有文件触发 → 必须在 `onLayoutReady` 之后注册
- 增量更新前用 mtime 守卫跳过未变化文件
- 使用 `app.appId` 实现 per-vault IndexedDB 命名空间隔离

**MiniSearch 技术细节**（来自源码调研）：
- npm 包：`minisearch`（773k+ 周下载，5.8k+ GitHub stars，最近发布 2025-09）
- Bundle：17.8 KB minified / 5.95 KB gzip
- `toJSON()` 输出包含 `serializationVersion: 2`，用于版本迁移检查
- `loadJSONAsync()` 内部分批加载（cooperative chunking on main thread），非 Worker 隔离
- `addAllAsync()` 同样为协作式分批，适合首次构建避免阻塞 UI
- 增量操作：`add()` 添加、`discard()` + `add()` 更新（`replace()` 是 discard+add 的便捷方法）、`remove()` 需要原始文档对象
- 默认按 Unicode 空格/标点分词；CJK 需自定义 `tokenize` 函数（见上方 CJK 分词策略）
- Fuzzy 搜索：`fuzzy: 0.2` = 最大编辑距离为 `0.2 × 词长`
- 内存基准：仓库内 `benchmarks/memory.js` 可测量堆增量和 `JSON.stringify()` 体积

**Omnisearch 实现细节**（来自源码调研）：
- 使用 Dexie（IndexedDB wrapper）存储序列化索引，表结构：`{ date, paths: DocumentRef[], data: AsPlainObject }`
- 写入缓存：`getSerializedMiniSearch()` → `database.minisearch.add({ data })`
- 读取缓存：`MiniSearch.loadJSAsync(cache.data, options)` → 加载完成后增量对比 mtime
- CJK 支持依赖独立中文分词插件，自定义 tokenizer 中 `chsRegex.test(word)` 判断是否走中文分词路径
- iOS 上因序列化/反序列化内存过高而禁用缓存（仅桌面端无此风险）

**IndexedDB 持久化元数据建议**（存储于索引旁）：
- `vaultId`：`app.appId`（per-vault 隔离）
- `schemaVersion`：索引结构版本（字段变更时自增）
- `tokenizerVersion`：分词逻辑版本（分词策略变更时自增，触发全量重建）
- `pluginVersion`：插件版本
- `docCount`：已索引文档数
- `lastIndexedAt`：最后构建时间戳
