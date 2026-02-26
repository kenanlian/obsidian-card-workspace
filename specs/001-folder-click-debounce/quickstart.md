# Quickstart — 同一文件夹重复点击短路与重复渲染防抖

## Prerequisites

- Obsidian 开发环境可用
- Node.js + npm 可用
- 仓库路径：`C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin`

## 1) Build & Type Check

```powershell
pwsh -Command "npm run check"
pwsh -Command "npm run build"
```

## 2) Run Plugin in Dev Vault

```powershell
pwsh -Command "npm run dev"
```

在 Obsidian 开启插件后，打开 `Folder Card Explorer` 侧栏视图。

## 3) Validation Scenarios

### Scenario A: 同目录重复点击短路（FR-001/002/003/006, SC-001/004）

1. 在文件管理器点击目录 A，等待卡片加载完成。
2. 2 秒内连续点击目录 A 10 次。
3. 预期：
   - 仅 1 次有效刷新（无重复任务堆积）
   - 卡片列表不闪动、不清空
   - 滚动位置与选中状态保持稳定

### Scenario B: 快速目录切换不丢事件（FR-004, SC-002）

1. 快速点击 A -> B -> C。
2. 预期：
   - 每次切换均被视为有效
   - 最终视图稳定显示 C 的卡片
   - 无旧目录结果回写覆盖

### Scenario C: 当前目录自动刷新（FR-005, SC-003）

1. 当前展示目录 A。
2. 在 A 中执行新增/修改/删除/重命名 Markdown。
3. 预期：
   - 无需再次点击目录，列表自动刷新
   - 95% 场景下 1 秒内反映结果

### Scenario D: 生命周期清理（FR-007）

1. 触发刷新后立刻关闭视图或禁用插件。
2. 预期：
   - 不出现延迟“幽灵刷新”
   - 无后续误触发任务

## 4) Evidence Table (SC-001 ~ SC-004)

| Success Criteria | Scenario | Observation | Status |
|---|---|---|---|
| SC-001 同目录 2 秒内 10 次点击仅 1 次刷新 | A | 待在 Obsidian 开发 Vault 中手动验证并记录刷新计数 | Pending |
| SC-002 A->B->C 快速切换成功率 >= 95% | B | 待在 Obsidian 开发 Vault 中手动验证并记录切换成功率 | Pending |
| SC-003 当前目录变更 95% 场景 1 秒内反映 | C | 待在 Obsidian 开发 Vault 中手动验证并记录更新时间 | Pending |
| SC-004 同目录短路时 95% 场景无闪动/重置 | A/B | 待在 Obsidian 开发 Vault 中手动验证并记录 UI 稳定性 | Pending |

## 5) Validation Command Log

| Date | Command | Result |
|---|---|---|
| 2026-02-26 | `npm run check` | Pass |
| 2026-02-26 | `npm run build` | Pass (`main.js` generated) |

## 6) Expected Artifacts

- `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\research.md`
- `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\data-model.md`
- `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\contracts\folder-click-debounce.openapi.yaml`
- `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\plan.md`
