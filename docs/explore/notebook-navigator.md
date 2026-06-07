# Notebook Navigator 调研笔记

## 概述

`Notebook Navigator` 是一个把 Obsidian 左侧文件浏览器升级为“可定制的双栏笔记浏览器”的插件。它的产品目标不是只改进文件夹树，而是把文件夹、标签、属性、快捷入口、搜索、批量操作、日历和多种显示选项收拢到一个统一的浏览与管理界面里。

从公开文档与源码看，它已经不是轻量级视图插件，而是一个带有本地缓存、后台内容管线、服务层、上下文分层和多视图协调能力的重型产品。对本项目而言，它更像“文件管理器替代方案”的研究对象，而不是单一的卡片列表参考实现。

## 基本信息

- 插件名：`Notebook Navigator`
- 作者：`Johan Sanneblad`
- 仓库：`https://github.com/johansan/notebook-navigator`
- 官方文档：`https://notebooknavigator.com/docs.html`
- 当前观测版本：`2.5.3`（来自 `package.json`）
- README 定位：用文件夹、标签、属性和快捷入口，把 Obsidian 变成一个“fast, customizable notes browser”，并声称可处理 `100,000+ notes`

## 功能点梳理

以下功能点主要来自官方 README / 文档和部分源码交叉验证。

### 1. 界面与浏览模式

- 双栏布局：`NavigationPane` + `ListPane`
- 单栏布局：在移动端或单栏模式下在导航与列表之间切换
- 可切换横向 / 纵向双栏方向
- 可调整 pane 尺寸
- 可独立调整 UI scale，不跟随 Obsidian 全局缩放
- 单独的右侧边栏日历视图 `NotebookNavigatorCalendarView`

### 2. 导航维度

- 文件夹树浏览
- 标签树浏览
- 属性树浏览
- 快捷入口（文件、文件夹、标签、属性、搜索）
- Recent notes / recent files
- Calendar 入口（daily / weekly / monthly / quarterly / yearly note）
- Vault profiles：为不同工作流保存不同的可见性规则、banner、shortcut 等配置

### 3. 文件展示能力

- 文件列表预览文本
- Feature image / thumbnail
- PDF thumbnail
- 显示标签、日期、父级文件夹、frontmatter 派生字段
- 日期分组显示
- Compact mode
- Per-folder / per-tag appearance override

### 4. 搜索与筛选

- 内建 filter search
- 可选集成 Omnisearch 做全文搜索
- filter search 支持：
  - 文件名词项
  - `#tag`
  - `.property=value`
  - `folder:...`
  - `ext:...`
  - `@date`
  - `has:task`
  - 排除条件与 AND / OR 组合
- 搜索结果可带 excerpt / highlight（Omnisearch provider 模式）

### 5. 交互与操作

- 全键盘导航
- 多选、范围选择、`Cmd/Ctrl+A`
- 拖拽排序 / 拖拽移动 / 标签树拖拽重组
- 右键菜单与命令系统
- 创建、移动、重命名、删除文件 / 文件夹
- Folder note 相关工作流
- 标签批量操作
- 属性批量设置

### 6. 定制化与生态集成

- 多语言支持
- RTL 支持
- 自定义 icon / color / background
- 外部 icon pack 下载与本地缓存
- Templater 集成
- Excalidraw / Tldraw / Canvas / Bases 创建入口

## 技术路线总结

Notebook Navigator 的技术路线可以概括为：

> **以本地缓存和派生数据为基础，把浏览、筛选、搜索、排序、批量操作和展示全部统一到一个长期驻留的 navigator runtime 中。**

它不是“读 vault -> 直接渲染”的路线，而是“**先维护本地数据底座，再让 UI 同步消费缓存与派生树**”。

这一点从它的几份官方架构文档里很一致：

- `docs/startup-process.md`：强调 cold boot / warm boot、数据库版本检查、后台 provider 管线、metadata cache gating
- `docs/storage-architecture.md`：明确把存储分成 `IndexedDB`、vault-scoped local storage、memory cache、settings、icon assets database
- `docs/metadata-pipeline.md`：把整个系统拆成 vault sync、derived content generation、tree indexing 三层
- `docs/rendering-architecture.md`：UI 直接同步读取缓存镜像，而不是每个组件各自做异步读取
- `docs/service-architecture.md`：业务逻辑被拆到 services，而不是堆在 React 组件里

## 技术选型

### 前端与构建

- `React 19`
- `react-dom 19`
- `@tanstack/react-virtual`
- `TypeScript`
- `esbuild`

### 交互能力

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

### 代码质量与测试

- `ESLint`
- `Prettier`
- `Vitest`

### 与本项目最关键的技术差异

和本项目当前的 `Svelte 4 + FolderCardView runtime + 虚拟卡片流` 相比，Notebook Navigator 走的是更明显的 **React 应用式架构**：

- 大量上下文 provider
- services / storage / controllers 分层
- IndexedDB + memory mirror
- 内容 provider 后台管线
- 双 pane 虚拟化

这决定了它更适合做“全功能浏览器”，而不是只优化某一个浏览视图。

## 架构拆解

### 1. 总体分层

从文档和源码可归纳为如下结构：

```text
Obsidian Runtime
  -> Plugin main / workspace coordination
  -> View layer (NotebookNavigatorView / CalendarView)
  -> React provider tree
  -> StorageContext + ContentProviderRegistry
  -> IndexedDBStorage + MemoryFileCache
  -> Tag/Property trees + derived list/navigation hooks
  -> Virtualized panes (NavigationPane / ListPane)
```

### 2. 视图层

- 主视图：`NotebookNavigatorView`
- 日历视图：`NotebookNavigatorCalendarView`
- React 根节点挂载在 Obsidian `ItemView` 内
- 通过 `WorkspaceCoordinator` 协调左侧 navigator leaf 与右侧 calendar leaf

这是典型的“插件拥有多个协同 View”的产品化结构，不只是一个单 View 插件。

### 3. 状态与依赖注入

根据 `rendering-architecture.md`，主 navigator React 树上包了多层 provider，包括：

- `SettingsContext`
- `UXPreferencesContext`
- `RecentDataContext`
- `ServicesContext`
- `ShortcutsContext`
- `StorageContext`
- `ExpansionContext`
- `SelectionContext`
- `UIStateContext`

这意味着它的状态模型是显式分层的：

- 持久化设置
- 设备本地偏好
- 最近使用数据
- 业务服务
- 缓存与内容同步
- 展开状态
- 选中状态
- pane 布局状态

这种结构的优点是职责清楚，缺点是系统复杂度与状态同步成本较高。

### 4. 存储架构

这是它最值得注意的技术核心。

#### IndexedDB

官方文档明确说明它把大量“可重建但昂贵”的派生数据存进 `IndexedDB`：

- per-file `FileData`
- preview text
- feature image blobs
- 各种 provider 的 processed mtimes

数据库命名也按 vault 隔离：`notebooknavigator/cache/{appId}`。

#### Memory mirror

`MemoryFileCache` 会把主记录镜像到 JS 内存里，用于 render path 中的同步读取。这一点非常关键：

> 它不是每次渲染时去 IndexedDB 异步拿数据，而是把“渲染必需的记录”先同步化到内存。

这直接服务于它的双 pane 虚拟化界面。

#### Local storage

它还把设备级 UI 状态、最近文件、sync-mode local mirror 等放进 vault-scoped local storage。

#### Settings

真正需要随 vault 同步的配置则放在 `data.json`。也就是说，它清楚地区分了：

- 哪些数据应该跟 vault 走
- 哪些数据应该只留在当前设备
- 哪些数据只是可重建缓存

### 5. 内容管线

`metadata-pipeline.md` 和源码都说明它使用 `ContentProviderRegistry` 协调后台内容生成。主要 provider 包括：

- `MarkdownPipelineContentProvider`
- `TagContentProvider`
- `MetadataContentProvider`
- `FeatureImageContentProvider`

这套设计把内容处理拆成几个独立 provider，再由统一 registry 负责：

- 注册 provider
- 选择哪些文件需要处理
- 在 settings 变化后重建对应内容
- 停止 / 恢复后台处理

这比“在 view 里直接读文件并顺手算 preview / tags / metadata”要复杂得多，但也更利于大规模缓存和后台增量处理。

### 6. 渲染架构

`rendering-architecture.md` 明确写了两边 pane 都使用 `@tanstack/react-virtual`：

- `useNavigationPaneScroll`
- `useListPaneScroll`

换句话说，它不是只有文件列表虚拟化，而是**导航树与列表都虚拟化**。这和本项目当前只聚焦卡片流虚拟化的思路不同。

此外它还做了：

- pending scroll intent queue
- version gating
- reveal / navigation jump 的延迟执行
- pane 可见性检测，避免隐藏态时做无效滚动

这说明它的滚动与视图切换系统已经是一个独立的复杂子系统。

### 7. 搜索架构

Notebook Navigator 的搜索不是单一实现，而是两层：

1. **internal filter search**
   - 主要基于缓存好的文件名、tags、properties、dates、tasks、folder path 做结构化过滤
   - 核心源码在 `src/utils/filterSearch.ts` 与 `src/hooks/listPaneData/searchPipeline.ts`
2. **Omnisearch integration**
   - 通过 `OmnisearchService` 调用外部 Omnisearch 插件 API
   - 用于全文搜索与 excerpt/highlight

所以它真正强的是“结构化过滤 + 外挂全文搜索增强”，而不是一个统一的自建全文搜索引擎。

## 优势

### 1. 产品边界非常完整

Notebook Navigator 已经超出“文件浏览器增强”范畴，几乎形成了一个围绕浏览与管理的完整工作台：

- 导航
- 搜索
- 快捷入口
- 批量操作
- 日历
- appearance customization
- 图标 / 颜色系统
- 命令与键盘体系

这让它在重度用户场景里有明显吸引力。

### 2. 数据层与 UI 层分离得很清楚

它没有把复杂逻辑直接塞进组件，而是分到：

- services
- storage hooks
- content providers
- tree services
- React contexts

这让大型功能可以持续叠加，而不必把所有状态堆在单一 view controller 中。

### 3. 大 vault 友好度很高

至少从公开设计与代码结构来看，它做了大量面向大 vault 的准备：

- IndexedDB 持久缓存
- 内存镜像供同步读取
- 双 pane 虚拟化
- metadata cache gating
- 批处理与后台内容 provider
- warm boot / cold boot 区分
- mtime 与 provider processed mtime 体系

README 里“`100,000+ notes`”的说法仍然是项目方自述，但它的技术路径确实是在往这个目标服务。

### 4. 文档质量高

它的官方文档比多数 Obsidian 插件完整很多，而且不是只写用户用法，还写了：

- startup process
- storage architecture
- rendering architecture
- service architecture
- metadata pipeline

这对长期维护非常有帮助，也降低了新贡献者理解成本。

### 5. 搜索与元数据浏览能力成熟

它的 internal search 已经远不只是“搜索框 contains 过滤”，而是接近一种轻量 query language。对于 tag / property / date / folder / task 这些 Obsidian 原生概念的支持很强。

## 潜在问题与风险

### 1. 架构复杂度高

Notebook Navigator 的最大优势也是它最大的潜在风险：系统太大。

复杂度来源包括：

- 多层 provider
- 多类缓存
- IndexedDB + local storage + settings + memory mirror
- 内容 provider 管线
- 多视图协调
- 大量服务单例

这意味着维护成本、调试成本、状态一致性风险都更高。对于小团队或单人维护来说，长期压力不小。

### 2. 状态同步面很广

它同时维护：

- Vault state
- IndexedDB cache
- memory cache
- tag / property tree
- React selection / expansion / UI state
- local storage mirrors
- settings

任何重命名、删除、迁移、provider settings 变化，都可能引发多层状态联动。这种系统容易出现“局部正确、整体不同步”的边缘问题。

### 3. 对缓存与后台管线的正确性要求极高

它的性能很大程度建立在缓存正确性上。如果缓存失效、provider 未及时重建、metadata cache 时序异常，就可能出现：

- tag / property 树不一致
- preview 过期
- feature image 错位
- 搜索 / 显示状态延迟更新

文档里专门保留了 `Rebuild cache` 命令，本身就说明缓存恢复机制是必要的，而不是纯兜底装饰。

### 4. 全文搜索依赖 Omnisearch

它的 internal filter search 很强，但真正的全文搜索仍依赖 Omnisearch。官方 README 也明确列了 Omnisearch 模式的局限：

- 大 vault 下短 query 可能慢
- path bug
- 因为先全 vault 搜索再按当前 scope 过滤，当前文件夹内的相关结果可能被全局结果淹没
- excerpt 不一定对应真正高亮命中处

所以在“真正统一、内建的全文搜索”这件事上，它并没有完全闭环。

### 5. 网络边界更复杂

虽然核心是本地运行，但它支持：

- release check
- icon pack 下载
- 外部图片与 YouTube thumbnail 下载

这意味着它不是一个完全“零网络边界”的插件。对隐私敏感用户来说，需要更明确地理解功能开关与数据流向。

## 对本项目的启发

### 最值得借鉴的点

1. **文档化的系统边界**：它把 startup / storage / rendering / services 都写成独立文档，这一点非常适合大幅降低维护成本。
2. **缓存与派生内容分层**：如果本项目未来继续做搜索、批量、更多 metadata 视图，这种“runtime state 与 derived content 分层”的思路值得借鉴。
3. **把大 vault 问题前置到架构里解决**：它不是等卡顿了再补优化，而是一开始就围绕 warm boot、cache、virtualization、background processing 设计。
4. **服务层与 UI 解耦**：对于文件操作、标签操作、属性操作、搜索 provider 这类能力，独立 service 能减少 view runtime 的持续膨胀。

### 不应该盲目复制的点

1. **不要为了“完整”而复制它的全部复杂度。** 本项目当前仍是更聚焦的卡片工作流产品，直接复制它的全功能 navigator 路线会显著稀释边界。
2. **不要把缓存系统做得过早过重。** 如果还没有明确需要支撑的功能矩阵，先把 MiniSearch、批量选择、结构化过滤补齐，比一次性引入整个 provider / tree / cache 体系更务实。
3. **不要把产品重心从“卡片流浏览”漂移成“替代文件浏览器”。** Notebook Navigator 已经在那个赛道里很深，本项目更适合守住 preview-first 的差异化定位。

## 适合如何作为对标对象

更适合把 Notebook Navigator 看成以下三类 benchmark：

1. **搜索与元数据浏览 benchmark**
2. **大 vault 本地缓存 / 启动恢复 benchmark**
3. **文档化和架构自解释程度 benchmark**

而不是把它当作 UI 风格或功能清单的逐项抄作业对象。

## 结论

Notebook Navigator 的本质是一套“本地缓存驱动的 Obsidian 浏览器运行时”。它比本项目更大、更重、更完整，也更像一个平台化产品。它的强项不只是功能多，而是已经把：

- 存储
- 派生内容
- 搜索
- 树结构导航
- 文件操作
- 虚拟化渲染
- 多视图协调

全部纳入了一套相对成形的系统。

对本项目而言，它最有价值的地方不在于“应该照着做成一样”，而在于提供了一个清晰案例：**如果一个 Obsidian 浏览器插件继续扩张，最终会长成怎样的架构与复杂度。**

## 参考资料

### 官方入口

- README：`https://github.com/johansan/notebook-navigator/blob/main/README.md`
- 官方文档首页：`https://notebooknavigator.com/docs.html`

### 官方架构文档

- Startup Process：`https://github.com/johansan/notebook-navigator/blob/main/docs/startup-process.md`
- Storage Architecture：`https://github.com/johansan/notebook-navigator/blob/main/docs/storage-architecture.md`
- Rendering Architecture：`https://github.com/johansan/notebook-navigator/blob/main/docs/rendering-architecture.md`
- Service Architecture：`https://github.com/johansan/notebook-navigator/blob/main/docs/service-architecture.md`
- Metadata Pipeline：`https://github.com/johansan/notebook-navigator/blob/main/docs/metadata-pipeline.md`

### 关键源码锚点

- `src/context/StorageContext.tsx`
- `src/context/storage/useIndexedDBReady.ts`
- `src/context/storage/useInitializeContentProviderRegistry.ts`
- `src/context/storage/useStorageVaultSync.ts`
- `src/services/content/ContentProviderRegistry.ts`
- `src/storage/IndexedDBStorage.ts`
- `src/storage/MemoryFileCache.ts`
- `src/hooks/useListPaneData.ts`
- `src/hooks/useListPaneScroll.ts`
- `src/utils/filterSearch.ts`
- `src/services/OmnisearchService.ts`

## 证据边界说明

- 本文中的功能点、技术选型、架构分层、存储模型、搜索模式、网络使用说明，均有 README、官方架构文档或源码片段支撑。
- 关于“面对 100,000+ notes 的真实表现”，目前只能说其技术路线显然在为大 vault 设计；README 中的量级说法仍属于项目方声明，不应视为独立验证结论。
- 关于长期维护风险、复杂度成本、状态同步压力，属于基于公开架构与源码形态做出的工程推断，不是仓库作者的自述。
