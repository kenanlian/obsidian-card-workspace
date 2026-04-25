# Decision: 采用 tag-driven GitHub Release 自动化作为最小发布链路

## Background

仓库此前只有 `.github/workflows/ci.yml`，能够在 `push` / `pull_request` 时执行安装、类型检查、构建和测试，但没有任何 GitHub Release 自动化。对 Obsidian 插件来说，这意味着项目虽然已经具备 `manifest.json`、`versions.json`、`main.js` 等发布基础，却仍需要维护者手工记住多个版本文件的对齐规则，并在 GitHub 页面上手动上传 release assets。

## Trigger signal

项目需要补齐“最小可用”的 GitHub Release 支持，但不希望一次性引入 changelog 生成、版本推断、release PR 或 npm publish 等更重的发布基础设施。

## Decision

采用一条以 Git tag 为触发器的最小 GitHub Release 链路：

- 新增 `.github/workflows/release.yml`，在 push 裸 semver tag（例如 `0.1.1`，而不是 `v0.1.1`）时运行。
- workflow 复用仓库已有的 `check:svelte`、`check`、`build`、`test` 校验链路；这也意味着 release 前的本地校验需要覆盖 `check:svelte`，而不只是常规三件套。
- 新增 `scripts/check-release.mjs`，把 tag / `package.json.version` / `manifest.json.version` / `versions.json[version]` 的对齐关系固化成可执行校验。
- 新增 `scripts/sync-version.mjs`，把版本 bump 的多文件更新收敛成 `npm run release:prepare -- <version> [minAppVersion]`。
- release workflow 在校验通过后创建 draft GitHub Release，并上传 `main.js`、`manifest.json`、`styles.css`。

## Why this option

这个方案满足了 Obsidian 插件对 GitHub Release 的硬约束，同时把复杂度控制在当前仓库真正需要的最低水平：

- 版本号仍由维护者显式决定，避免自动推断版本导致错误发版。
- workflow 只做校验与发布，不复制第二套构建逻辑。
- 版本对齐规则被脚本化后，不再依赖人工记忆多文件同步。
- 发布资产 contract 被固定成 `main.js`、`manifest.json`、`styles.css`，不会因为后续维护者不熟悉 Obsidian 约束而漏传文件。

## Impact

- 仓库现在具备最小 draft GitHub Release 自动化能力。
- 版本发布流程多了两个明确入口：`npm run release:prepare` 和 `npm run release:check`。
- README、`docs/START_HERE.md`、`docs/architecture.md` 现在都把发布链路视作正式仓库 contract，而不是一次性操作说明。

## Cost and risk

- GitHub 仓库仍需要外部设置 `Actions -> Workflow permissions -> Read and write`，否则 workflow 无法创建 release。
- 当前方案不会自动生成 changelog，也不会自动决定版本号，维护者仍需要显式准备版本 bump commit，并创建与 `manifest.json.version` 完全一致的裸 semver tag。
- tag push 会让现有 `ci.yml` 和新的 `release.yml` 都运行，这在最小方案下是可接受的重复校验，但不是最省资源的方案。

## Alternatives considered

### 1. 继续手工在 GitHub 页面创建 release

被拒绝。这样虽然零基础设施成本，但版本对齐和 release assets 上传仍完全依赖人工记忆，长期维护风险过高。

### 2. 引入 `semantic-release` / `release-please`

被拒绝。当前仓库还不需要自动版本推断、release PR 或 changelog 驱动发版；引入这类工具会显著增加配置复杂度和调试成本。

### 3. 只加 workflow，不加本地版本脚本

被拒绝。这样 GitHub 上可以自动创建 release，但本地版本准备仍缺少统一入口，无法真正降低多文件漏改的风险。

## Follow-up actions

- 真正首次发版前，在 GitHub 仓库设置里确认 Actions workflow permissions 为 `Read and write`。
- 后续每次 release 都通过 `release:prepare` / `release:check` 维护版本 contract。
- 如果未来需要 changelog 或 release PR，再在当前 tag-driven contract 外层扩展，而不是替换现有最小链路。

## Supersedes / related records

- 不 supersede 既有架构决策。
- 相关记录：`docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`

## Related files

- `.github/workflows/release.yml`
- `scripts/check-release.mjs`
- `scripts/sync-version.mjs`
- `src/release-support.test.ts`
- `README.md`
