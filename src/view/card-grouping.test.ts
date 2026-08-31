import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import type { GroupDimension, GroupOrderBy, GroupSpec } from "../card-grouping-settings";
import { getUiStrings } from "../i18n";
import type { SortDirection } from "../settings";
import {
  arrangeCardsByGroup,
  buildGroupBuckets,
  type GroupArrangement,
  type GroupLabels,
} from "./card-grouping";
import type { CardTaskSummary } from "./task-summary";
import type { NoteCardRecord, Rule } from "./types";

const STRINGS = getUiStrings("zh");

const LABELS: GroupLabels = {
  vaultRoot: STRINGS.sortGroup.bucketVaultRoot,
  noTag: STRINGS.sortGroup.bucketNoTag,
  noTask: STRINGS.sortGroup.bucketNoTask,
  manual: STRINGS.sortGroup.bucketManual,
};

const ORDER_BY_VALUES: GroupOrderBy[] = ["default", "name", "count"];
const DIRECTIONS: SortDirection[] = ["asc", "desc"];

function createApp(tagsByPath: Record<string, string[]> = {}): App {
  return {
    metadataCache: {
      getFileCache: (file: TFile) => {
        const tags = tagsByPath[file.path];
        return tags === undefined ? null : { tags: tags.map((tag) => ({ tag })) };
      },
    },
    vault: {
      getAbstractFileByPath: (path: string) => ({ path }) as unknown as TFile,
    },
  } as unknown as App;
}

function createCard(path: string, overrides: Partial<NoteCardRecord> = {}): NoteCardRecord {
  return {
    file: { path } as unknown as TFile,
    fileKind: "markdown",
    path,
    title: path,
    ctime: 0,
    mtime: 0,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
    ...overrides,
  };
}

function createRule(overrides: Partial<Rule> & { id: string }): Rule {
  return {
    folder: "",
    includeSubfolders: true,
    tags: [],
    name: "",
    ...overrides,
  };
}

function createSpec(
  dimension: GroupDimension,
  orderBy: GroupOrderBy = "default",
  orderDirection: SortDirection = "asc",
): GroupSpec {
  return { dimension, orderBy, orderDirection };
}

function arrange(
  app: App,
  cards: NoteCardRecord[],
  spec: GroupSpec,
  rules: readonly Rule[] = [],
  collapsedKeys: ReadonlySet<string> = new Set(),
): GroupArrangement {
  const buckets = buildGroupBuckets(app, cards, spec, rules, LABELS, STRINGS);
  return arrangeCardsByGroup(cards, buckets, spec, collapsedKeys);
}

function segmentKeys(result: GroupArrangement): string[] {
  return result.segments.map((segment) => segment.key);
}

function totalSegmentCount(result: GroupArrangement): number {
  return result.segments.reduce((total, segment) => total + segment.count, 0);
}

// V4 ------------------------------------------------------------------------

describe("buildGroupBuckets — folder dimension", () => {
  const app = createApp();

  it("groups a nested file by its direct parent", () => {
    const cards = [createCard("a/b/note.md")];
    const result = arrange(app, cards, createSpec("folder"));

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      key: "folder:a/b",
      label: "b",
      detail: "a/b",
      isMissingBucket: false,
    });
  });

  it("groups a vault-root file under the localized root label with an empty detail", () => {
    const cards = [createCard("root.md")];
    const result = arrange(app, cards, createSpec("folder"));

    expect(result.segments[0]).toMatchObject({
      key: "folder:",
      label: "库根",
      detail: "",
    });
  });

  it("produces two segments for files in sibling folders", () => {
    const cards = [createCard("a/one.md"), createCard("b/two.md")];
    const result = arrange(app, cards, createSpec("folder"));

    expect(segmentKeys(result)).toEqual(["folder:a", "folder:b"]);
    expect(totalSegmentCount(result)).toBe(cards.length);
  });

  it("does not group a deeply nested file by its grandparent", () => {
    const cards = [createCard("a/b/c/note.md")];
    const result = arrange(app, cards, createSpec("folder"));

    expect(result.segments[0].key).toBe("folder:a/b/c");
    expect(result.segments[0].label).toBe("c");
  });
});

// V5 ------------------------------------------------------------------------

describe("buildGroupBuckets — tag dimension", () => {
  it("uses the first tag by normalized order", () => {
    const cards = [createCard("note.md")];
    const app = createApp({ "note.md": ["#b", "#a", "#c"] });
    const result = arrange(app, cards, createSpec("tag"));

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ key: "tag:a", label: "#a", detail: "" });
    expect(totalSegmentCount(result)).toBe(cards.length);
  });

  it("keys by the normalized tag while labelling with the display form", () => {
    const cards = [createCard("note.md")];
    const app = createApp({ "note.md": ["#Work"] });
    const result = arrange(app, cards, createSpec("tag"));

    expect(result.segments[0]).toMatchObject({ key: "tag:work", label: "#Work" });
  });

  it("labels a mixed-casing tag group identically regardless of card order", () => {
    const app = createApp({ "upper.md": ["#Work"], "lower.md": ["#work"] });
    const forward = [createCard("upper.md"), createCard("lower.md")];
    const reversed = [createCard("lower.md"), createCard("upper.md")];

    const forwardResult = arrange(app, forward, createSpec("tag"));
    const reversedResult = arrange(app, reversed, createSpec("tag"));

    // Without a canonical choice the header would follow whichever card sorted
    // first, so these two would disagree.
    expect(forwardResult.segments).toHaveLength(1);
    expect(reversedResult.segments).toHaveLength(1);
    expect(forwardResult.segments[0].label).toBe("#Work");
    expect(reversedResult.segments[0].label).toBe("#Work");
    expect(totalSegmentCount(forwardResult)).toBe(2);
  });

  it("treats nested tag paths as distinct groups", () => {
    const cards = [createCard("one.md"), createCard("two.md")];
    const app = createApp({ "one.md": ["#a/b"], "two.md": ["#a/c"] });
    const result = arrange(app, cards, createSpec("tag"));

    expect(segmentKeys(result)).toEqual(["tag:a/b", "tag:a/c"]);
    expect(totalSegmentCount(result)).toBe(cards.length);
  });

  it("sends an untagged card to the missing bucket", () => {
    const cards = [createCard("one.md"), createCard("two.md")];
    const app = createApp({ "one.md": ["#a"] });
    const result = arrange(app, cards, createSpec("tag"));

    expect(segmentKeys(result)).toEqual(["tag:a", "tag:__none__"]);
    expect(result.segments[1]).toMatchObject({
      label: "无标签",
      isMissingBucket: true,
      count: 1,
    });
    expect(totalSegmentCount(result)).toBe(cards.length);
  });
});

// V6 ------------------------------------------------------------------------

describe("buildGroupBuckets — box-rule dimension", () => {
  const app = createApp();
  const rules: Rule[] = [
    createRule({ id: "r0", folder: "projects" }),
    createRule({ id: "r1", folder: "archive" }),
    createRule({ id: "r2", folder: "" }),
  ];

  it("uses the first matching rule in box order", () => {
    const cards = [createCard("projects/alpha.md")];
    const result = arrange(app, cards, createSpec("box-rule"), rules);

    expect(result.segments[0]).toMatchObject({ key: "rule:r0", isMissingBucket: false });
  });

  it("sends a manual-only member to the manual bucket", () => {
    const scopedRules = [rules[0], rules[1]];
    const cards = [createCard("inbox/note.md")];
    const result = arrange(app, cards, createSpec("box-rule"), scopedRules);

    expect(result.segments[0]).toMatchObject({
      key: "rule:__manual__",
      label: "手动添加",
      isMissingBucket: false,
      count: 1,
    });
  });

  it("puts every member in the manual bucket for a zero-rule box", () => {
    const cards = [createCard("a/one.md"), createCard("b/two.md")];

    expect(() => arrange(app, cards, createSpec("box-rule"), [])).not.toThrow();

    const result = arrange(app, cards, createSpec("box-rule"), []);
    expect(segmentKeys(result)).toEqual(["rule:__manual__"]);
    expect(result.segments[0].count).toBe(2);
  });

  it("honours an explicit rule name", () => {
    const namedRules = [createRule({ id: "r0", folder: "projects", name: "Active work" })];
    const cards = [createCard("projects/alpha.md")];
    const result = arrange(app, cards, createSpec("box-rule"), namedRules);

    expect(result.segments[0].label).toBe("Active work");
  });
});

// V7 ------------------------------------------------------------------------

describe("buildGroupBuckets — task dimension", () => {
  const app = createApp();

  function bucketKeyFor(taskSummary: CardTaskSummary | null, fileKind?: "canvas"): string {
    const card = createCard(
      "note.md",
      fileKind === undefined ? { taskSummary } : { taskSummary, fileKind },
    );
    return arrange(app, [card], createSpec("task")).segments[0].key;
  }

  it("routes a card with unfinished tasks to the incomplete bucket", () => {
    expect(bucketKeyFor({ total: 3, incomplete: 1 })).toBe("task:incomplete");
  });

  it("routes a card whose tasks are all done to the complete bucket", () => {
    expect(bucketKeyFor({ total: 3, incomplete: 0 })).toBe("task:complete");
  });

  it("routes a card without a summary to the missing bucket", () => {
    const card = createCard("note.md", { taskSummary: null });
    const segment = arrange(app, [card], createSpec("task")).segments[0];

    expect(segment).toMatchObject({
      key: "task:none",
      label: "无任务",
      isMissingBucket: true,
    });
  });

  it("routes a non-markdown card to the no-task bucket", () => {
    const card = createCard("board.canvas", { fileKind: "canvas", taskSummary: null });
    const segment = arrange(app, [card], createSpec("task")).segments[0];

    expect(segment).toMatchObject({ key: "task:none", label: "无任务" });
  });
});

// V8 ------------------------------------------------------------------------

describe("arrangeCardsByGroup — ordering", () => {
  const app = createApp();

  it("orders folder groups by path ascending under the default order", () => {
    const cards = [createCard("c/one.md"), createCard("a/two.md"), createCard("b/three.md")];
    const result = arrange(app, cards, createSpec("folder"));

    expect(segmentKeys(result)).toEqual(["folder:a", "folder:b", "folder:c"]);
  });

  it("orders by label under `name`, which differs from the default path order", () => {
    const cards = [createCard("zzz/a/one.md"), createCard("b/two.md")];

    expect(segmentKeys(arrange(app, cards, createSpec("folder", "default")))).toEqual([
      "folder:b",
      "folder:zzz/a",
    ]);
    expect(segmentKeys(arrange(app, cards, createSpec("folder", "name")))).toEqual([
      "folder:zzz/a",
      "folder:b",
    ]);
    expect(segmentKeys(arrange(app, cards, createSpec("folder", "name", "desc")))).toEqual([
      "folder:b",
      "folder:zzz/a",
    ]);
  });

  it("orders by member count with a default-order tie-break", () => {
    const cards = [
      createCard("a/one.md"),
      createCard("a/two.md"),
      createCard("c/three.md"),
      createCard("b/four.md"),
    ];

    expect(segmentKeys(arrange(app, cards, createSpec("folder", "count")))).toEqual([
      "folder:b",
      "folder:c",
      "folder:a",
    ]);
    expect(segmentKeys(arrange(app, cards, createSpec("folder", "count", "desc")))).toEqual([
      "folder:a",
      "folder:c",
      "folder:b",
    ]);
  });

  it("reverses the default order under `desc`", () => {
    const cards = [createCard("c/one.md"), createCard("a/two.md"), createCard("b/three.md")];
    const result = arrange(app, cards, createSpec("folder", "default", "desc"));

    expect(segmentKeys(result)).toEqual(["folder:c", "folder:b", "folder:a"]);
  });

  it("keeps the missing bucket last for every order and direction", () => {
    const cards = [
      createCard("one.md"),
      createCard("two.md"),
      createCard("three.md"),
      createCard("four.md"),
    ];
    const taggedApp = createApp({
      "one.md": ["#zeta"],
      "two.md": ["#alpha"],
      "three.md": ["#alpha"],
    });

    for (const orderBy of ORDER_BY_VALUES) {
      for (const orderDirection of DIRECTIONS) {
        const result = arrange(taggedApp, cards, createSpec("tag", orderBy, orderDirection));
        const keys = segmentKeys(result);

        expect(keys).toHaveLength(3);
        expect(keys[keys.length - 1]).toBe("tag:__none__");
      }
    }
  });

  it("keeps the box-rule manual bucket last for every order and direction", () => {
    const rules = [createRule({ id: "r0", folder: "alpha" }), createRule({ id: "r1", folder: "beta" })];
    const cards = [
      createCard("alpha/one.md"),
      createCard("alpha/two.md"),
      createCard("beta/three.md"),
      createCard("beta/four.md"),
      createCard("beta/five.md"),
      createCard("inbox/manual.md"),
    ];

    for (const orderBy of ORDER_BY_VALUES) {
      for (const orderDirection of DIRECTIONS) {
        const result = arrange(app, cards, createSpec("box-rule", orderBy, orderDirection), rules);
        const keys = segmentKeys(result);

        expect(keys).toHaveLength(3);
        expect(keys[keys.length - 1]).toBe("rule:__manual__");
      }
    }
  });

  it("orders task groups incomplete, complete, none by default", () => {
    const cards = [
      createCard("none.md", { taskSummary: null }),
      createCard("done.md", { taskSummary: { total: 2, incomplete: 0 } }),
      createCard("open.md", { taskSummary: { total: 2, incomplete: 2 } }),
    ];
    const result = arrange(app, cards, createSpec("task"));

    expect(segmentKeys(result)).toEqual(["task:incomplete", "task:complete", "task:none"]);
  });
});

// V9 ------------------------------------------------------------------------

describe("arrangeCardsByGroup — stability", () => {
  it("keeps input order inside a group so a pinned card leads its own group only", () => {
    const app = createApp();
    const cards = [
      createCard("b/pinned.md"),
      createCard("a/first.md"),
      createCard("b/other.md"),
    ];
    const result = arrange(app, cards, createSpec("folder"));

    expect(result.cards.map((card) => card.path)).toEqual([
      "a/first.md",
      "b/pinned.md",
      "b/other.md",
    ]);
  });
});

// V10 -----------------------------------------------------------------------

describe("arrangeCardsByGroup — collapse", () => {
  const app = createApp();
  const cards = [
    createCard("a/one.md"),
    createCard("a/two.md"),
    createCard("b/three.md"),
    createCard("c/four.md"),
  ];

  it("drops a collapsed group's cards while keeping its segment intact", () => {
    const result = arrange(app, cards, createSpec("folder"), [], new Set(["folder:a"]));

    expect(result.cards.map((card) => card.path)).toEqual(["b/three.md", "c/four.md"]);
    expect(result.segments[0]).toMatchObject({
      key: "folder:a",
      collapsed: true,
      visibleCount: 0,
      count: 2,
      startIndex: 0,
    });
    expect(result.segments[1]).toMatchObject({ key: "folder:b", startIndex: 0, visibleCount: 1 });
    expect(result.segments[2]).toMatchObject({ key: "folder:c", startIndex: 1, visibleCount: 1 });
  });

  it("yields zero cards and a full segment list when every group is collapsed", () => {
    const collapsedKeys = new Set(["folder:a", "folder:b", "folder:c"]);
    const result = arrange(app, cards, createSpec("folder"), [], collapsedKeys);

    expect(result.cards).toEqual([]);
    expect(segmentKeys(result)).toEqual(["folder:a", "folder:b", "folder:c"]);
    expect(result.segments.every((segment) => segment.collapsed && segment.startIndex === 0)).toBe(
      true,
    );
  });

  it("ignores a collapsed key that matches no segment", () => {
    const baseline = arrange(app, cards, createSpec("folder"));
    const result = arrange(app, cards, createSpec("folder"), [], new Set(["folder:missing"]));

    expect(result).toEqual(baseline);
  });
});

// V11 -----------------------------------------------------------------------

describe("arrangeCardsByGroup — ungrouped", () => {
  it("returns the input array reference and no segments for `none`", () => {
    const cards = [createCard("a/one.md")];
    const result = arrangeCardsByGroup(cards, new Map(), createSpec("none"), new Set());

    expect(result.cards).toBe(cards);
    expect(result.segments).toEqual([]);
  });

  it("builds no buckets for `none`", () => {
    const cards = [createCard("a/one.md")];

    expect(buildGroupBuckets(createApp(), cards, createSpec("none"), [], LABELS, STRINGS).size).toBe(
      0,
    );
  });
});

// Failure behavior ----------------------------------------------------------

describe("arrangeCardsByGroup — degraded inputs", () => {
  it("returns an empty arrangement for an empty card array", () => {
    expect(arrangeCardsByGroup([], new Map(), createSpec("folder"), new Set())).toEqual({
      cards: [],
      segments: [],
    });
  });

  it("routes cards with no bucket entry into a missing bucket instead of dropping them", () => {
    const cards = [createCard("a/one.md"), createCard("a/two.md")];
    const result = arrangeCardsByGroup(cards, new Map(), createSpec("folder"), new Set());

    expect(result.cards).toHaveLength(2);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ count: 2, isMissingBucket: true });
  });

  it("keeps cardinality when only some bucket entries are absent", () => {
    const app = createApp();
    const cards = [createCard("a/one.md"), createCard("b/two.md")];
    const spec = createSpec("folder");
    const buckets = buildGroupBuckets(app, cards, spec, [], LABELS, STRINGS);
    buckets.delete("b/two.md");

    const result = arrangeCardsByGroup(cards, buckets, spec, new Set());

    expect(result.cards).toHaveLength(2);
    expect(totalSegmentCount(result)).toBe(2);
    expect(result.segments[result.segments.length - 1].isMissingBucket).toBe(true);
  });
});
