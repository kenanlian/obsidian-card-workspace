
- Chose to remove (not alias) `bulk-trash-selected` handling in runtime dispatch to satisfy the single-action contract and avoid hidden compatibility branches in Task 5.

- Task 7 keeps search index/document bodies markdown-only by mapping VaultMutationEvent.fileKind back to search isMarkdown and filtering out .excalidraw.md from indexed document ingestion.
- Task 7 keeps FolderCardPanel.svelte unchanged and updates Task 7 scoped tests to validate runtime supported-file behavior without pulling empty-state copy changes into this step.

- Decision: keep markdown-body-only indexing scope unchanged; fix rename correctness by widening only the mutation classification signal for rename events (based on oldPath markdown detection), not document indexing eligibility.
