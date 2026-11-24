# Rejected desktop scroll comparison, 24 November 2026

Independent verification compared baseline `030bc84ef9871587c55917da6e1fc46de7410c8d` (A) with candidate `77a25aeab498fcde328d977d682df62676813ca8` (B) in macOS Obsidian 1.13.4 with 1,000 text notes. Both execution orders exited 1 at line 225 of the historical runner. The gate failed when the lowest of B’s three frame-interval P95s exceeded the highest of A’s three by more than 0.1 ms.

| Run order | Expanded streams | A P95, ms (rounds 1–3) | B P95, ms (rounds 1–3) | A final scrollTop / card | B final scrollTop / card |
|---|---:|---|---|---|---|
| A then B | 1 | 17.3 / 16.8 / 17.1 | 16.8 / 16.8 / 16.8 | 9152 / 0293 | 9216 / 0297 |
| A then B | 2 | 18.1 / 18.3 / 18.0 | **18.6 / 18.5 / 18.6** | 9216 / 0149 | 9216 / 0149 |
| A then B | 4 | 16.9 / 17.6 / 18.3 | 18.3 / 18.2 / 18.2 | 11104 / 0179 | 11104 / 0179 |
| B then A | 1 | 16.8 / 16.8 / 16.8 | **17.0 / 17.5 / 18.5** | 9216 / 0297 | 9152 / 0293 |
| B then A | 2 | 18.1 / 17.3 / 18.0 | 18.6 / 18.2 / 18.0 | 9152 / 0147 | 9216 / 0149 |
| B then A | 4 | 18.2 / 16.8 / 18.2 | 18.1 / 16.8 / 18.5 | 11104 / 0179 | 11104 / 0179 |

Bold marks the comparison that raised the assertion in each run. Each card number identifies the saved anchor path, e.g. `Notes/Note 0293.md`. All twelve lane/stream configurations restored their own saved card and offset. All rounds recorded zero empty viewports and stationary sibling streams.

The historical input added 32 px to the *current* scroll offset for 120 frames per round. Row height adjustments could change the next frame’s starting point. In both single-stream comparisons the lanes diverged by 32, 32 and 64 px at the three round endpoints. The first lane reached card 0293 at offset 118.25 px in both run orders, the second card 0297 at 58.5 px. The reverse-order two-stream lanes also diverged. Consequently, equal input counts and equal viewport sizes alone could pair different card content.

The forward two-stream failure also occurred **with matching observed endpoints** (3072, 6144, 9216 px), matching viewport size (633 × 674 px) and matching final anchor (card 0149, offset 58.5 px). For those three rounds, CDP renderer script time was 134 / 136 / 132 ms for A and 120 / 116 / 115 ms for B. Layout time was 80 / 90 / 86 versus 84 / 91 / 93 ms. Total renderer task time was 456 / 439 / 423 versus 438 / 454 / 437 ms. These are whole-round durations; they do not identify the work on the slowest frames. The historical runner recorded neither per-frame work equality nor independent same-version control pairs. Attribution of the P95 failures to product changes or measurement variation therefore remained open at rejection.

## Preserved evidence

Under the Taskflow artifact root, `verification/044b7475-ae39-4829-b57f-2a697ed24cff/report.json` records commands, exit status, clean commit and tree. The original files beside it have these SHA-256 digests.

| File | SHA-256 |
|---|---|
| `host-ab.stdout.log` | `31d7abd28c8729d8e7b7c7a7e75aef15a09d49b871160653c14103b85423abb7` |
| `host-ab.stderr.log` | `c5f3ed6192332262ad8b305f8a148d2513a8a4334a5deee379604b51a996bb04` |
| `host-ba.stdout.log` | `6f70a5b7ca1132895ce35a9378ef84669166ac61f659e20ceafea70cb8376c52` |
| `host-ba.stderr.log` | `b1675ba2851c34de5652d5f31b496358f94cc206f6858bda445c249f65893602` |

## Reproduce the historical method

Run the following from the repository root on a Mac with Obsidian 1.13.4 installed at `/Applications/Obsidian.app` and the locked dependencies installed locally. The historical runner reads its candidate from Git HEAD. A temporary bare repository gives the runner its historical HEAD and read access to both local revisions. Each run starts its own isolated profiles. The commands retain both orders’ output and exit codes under `TMPDIR`.

```sh
(
  set -eu
  historical=77a25aeab498fcde328d977d682df62676813ca8
  scratch=$(mktemp -d "${TMPDIR:?}/scroll-history.XXXXXX")
  objects=$(git rev-parse --path-format=absolute --git-path objects)
  ln -s "$PWD/node_modules" "$scratch/node_modules"
  git init --quiet --bare "$scratch/revisions.git"
  cd "$scratch"
  export GIT_DIR="$scratch/revisions.git" GIT_ALTERNATE_OBJECT_DIRECTORIES="$objects"
  git update-ref --no-deref HEAD "$historical"
  git show HEAD:scripts/check-multi-stream-obsidian.mjs > runner.mjs
  ab=0
  node runner.mjs > host-ab.stdout.log 2> host-ab.stderr.log || ab=$?
  ba=0
  node runner.mjs --candidate-first > host-ba.stdout.log 2> host-ba.stderr.log || ba=$?
  printf 'Output %s\nAB exit %s, BA exit %s\n' "$scratch" "$ab" "$ba"
  test "$ab" -eq 0 && test "$ba" -eq 0
)
```
