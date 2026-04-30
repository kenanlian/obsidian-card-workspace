
- No blockers encountered in Task 3 implementation; one failing fixture was resolved by adding `defaultOpenDestination` to a test-local `getSettings()` override.

- No blockers in Task 3 follow-up; required-field restoration only needed one direct fixture update in `FolderCardPanel.svelte.test.ts`.

- No blockers encountered in Task 7; the change fit cleanly into plugin startup and the existing harness only needed one new mock method.

- Task 6 blocker encountered/resolved during verification: TypeScript rejected `openPopoutLeaf` as Promise-only in a narrowed cast; fixed by allowing `WorkspaceLeaf | Promise<WorkspaceLeaf>` and awaiting the result.
- Task 6 test typing snag resolved: mocked `TFile` constructor in this suite is zero-arg, so tests now instantiate `new TFile()` and set `.path` directly.

- No blockers encountered in Task 5; contextmenu/button trigger routing, shared menu ordering, and destination action wiring were implemented and verified without needing additional helper files.

- No blockers encountered in Task 8; implementation and verification passed with only expected pre-existing Svelte a11y warnings plus one new warning for title-group mouseenter on a static div.

- No blockers in Task 8 verification follow-up; minimal ARIA-role adjustment on the title-group element resolved the CardItem-specific warning while preserving behavior.

- Task bugfix note: initial regression assertion used an external receiver object and produced expected unhandled rejections under detached semantics; test was corrected to assert plugin-receiver binding directly while still failing on detached-call implementations.
