/**
 * Markdown content generators for the synthetic benchmark fixtures.
 *
 * All generators draw from a single seeded PRNG stream and use fixed
 * vocabularies, so output is byte-identical across runs. Vocabularies are
 * deliberately kept free of the benchmark needle tokens and the Han needle
 * characters so query needles stay unique to their marker documents.
 */

import { nextInt, pickFrom, type DeterministicRandom } from "./prng";

const ENGLISH_WORDS = [
  "vault", "folder", "note", "card", "search", "index", "token", "query", "filter",
  "pin", "favorite", "merge", "stream", "panel", "toolbar", "navigation", "tag",
  "property", "setting", "theme", "layout", "scroll", "preview", "markdown",
  "canvas", "base", "excalidraw", "plugin", "release", "version", "build", "test",
  "check", "lint", "svelte", "observer", "event", "snapshot", "restore", "rebuild",
  "worker", "reader", "debounce", "idle", "window", "slice", "batch", "summary",
  "detail", "column", "row", "group", "sort", "collapse", "reorder", "drop",
  "insert", "editor", "link", "backlink", "outline", "heading", "list", "fence",
  "frontmatter", "excerpt", "highlight", "match", "score", "boost", "prefix",
  "fuzzy", "schema", "storage", "memory", "heap", "clone", "benchmark",
] as const;

const HAN_WORDS = [
  "笔记", "卡片", "搜索", "索引", "标签", "属性", "收藏", "置顶", "合并", "文件夹",
  "面板", "工具栏", "导航", "排序", "分组", "折叠", "预览", "高亮", "匹配", "评分",
  "前缀", "模糊", "快照", "恢复", "重建", "观察者", "事件", "设置", "主题", "布局",
  "滚动", "批量", "摘要", "详情", "链接", "反向链接", "大纲", "标题", "列表", "围栏",
  "元数据", "摘录", "工作区", "插件", "版本", "构建", "测试", "检查", "基准", "内存",
  "堆", "克隆", "去抖", "空闲", "切片",
] as const;

const HAN_CONNECTORS = ["的", "与", "和", "在", "对于", "通过", "并且", "或者", "以及", "从", "向"] as const;

const MIXED_PAIRS = [
  ["card", "卡片"], ["search", "搜索"], ["index", "索引"], ["folder", "文件夹"],
  ["tag", "标签"], ["pin", "置顶"], ["note", "笔记"], ["preview", "预览"],
  ["snapshot", "快照"], ["rebuild", "重建"],
] as const;

const TAGS = ["inbox", "reading", "project", "meeting", "idea", "daily", "reference"] as const;

const CODE_LINES = [
  "npm run benchmark:search -- --profile smoke",
  "npm test -- --project node",
  "git log --oneline -3",
  "npm run check && npm run check:svelte",
  "echo 'deterministic fixture'",
] as const;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function englishSentence(random: DeterministicRandom): string {
  const length = nextInt(random, 6, 14);
  const words: string[] = [];
  for (let index = 0; index < length; index += 1) {
    words.push(pickFrom(random, ENGLISH_WORDS));
  }
  return `${capitalize(words[0] ?? "note")} ${words.slice(1).join(" ")}.`;
}

export function englishTitle(random: DeterministicRandom): string {
  const length = nextInt(random, 2, 4);
  const words: string[] = [];
  for (let index = 0; index < length; index += 1) {
    words.push(capitalize(pickFrom(random, ENGLISH_WORDS)));
  }
  return words.join(" ");
}

function hanSentence(random: DeterministicRandom): string {
  const length = nextInt(random, 4, 10);
  const words: string[] = [];
  for (let index = 0; index < length; index += 1) {
    words.push(pickFrom(random, HAN_WORDS));
    if (index + 1 < length && random() < 0.25) {
      words.push(pickFrom(random, HAN_CONNECTORS));
    }
  }
  return `${words.join("")}。`;
}

export function hanTitle(random: DeterministicRandom): string {
  const length = nextInt(random, 2, 3);
  const words: string[] = [];
  for (let index = 0; index < length; index += 1) {
    words.push(pickFrom(random, HAN_WORDS));
  }
  return words.join("");
}

/** Mixed-profile title: one English word and its Han counterpart. */
export function mixedTitle(random: DeterministicRandom): string {
  const [english, han] = pickFrom(random, MIXED_PAIRS);
  return `${capitalize(english)} ${han}`;
}

export function buildEnglishMarkdown(random: DeterministicRandom): string {
  const lines: string[] = [];
  if (random() < 0.6) {
    lines.push(`---\ntags: [${pickFrom(random, TAGS)}, ${pickFrom(random, TAGS)}]\ncreated: bench\n---`, "");
  }
  lines.push(`# ${englishTitle(random)}`, "");
  const paragraphCount = nextInt(random, 2, 5);
  for (let index = 0; index < paragraphCount; index += 1) {
    const sentenceCount = nextInt(random, 3, 6);
    const sentences: string[] = [];
    for (let s = 0; s < sentenceCount; s += 1) {
      sentences.push(englishSentence(random));
    }
    lines.push(sentences.join(" "), "");
  }
  if (random() < 0.5) {
    lines.push(`## ${englishTitle(random)}`, "");
    const itemCount = nextInt(random, 3, 6);
    for (let index = 0; index < itemCount; index += 1) {
      lines.push(`- ${englishSentence(random)}`);
    }
    lines.push("");
  }
  if (random() < 0.4) {
    lines.push("```sh", pickFrom(random, CODE_LINES), "```", "");
  }
  if (random() < 0.3) {
    const target = nextInt(random, 1, 400);
    lines.push(`Related: [[bench/english/note-${String(target).padStart(4, "0")}|see also]] and [[bench/english/note-${String(nextInt(random, 1, 400)).padStart(4, "0")}]]`, "");
  }
  if (random() < 0.2) {
    lines.push(`Inline $x_{${nextInt(random, 1, 99)}}$ math and a \`vault adapter\` code span.`, "");
  }
  return lines.join("\n");
}

export function buildHanMarkdown(random: DeterministicRandom): string {
  const lines: string[] = [];
  if (random() < 0.5) {
    lines.push(`---\ntags: [${pickFrom(random, TAGS)}]\n---`, "");
  }
  lines.push(`# ${hanTitle(random)}`, "");
  const paragraphCount = nextInt(random, 2, 5);
  for (let index = 0; index < paragraphCount; index += 1) {
    const sentenceCount = nextInt(random, 3, 7);
    const sentences: string[] = [];
    for (let s = 0; s < sentenceCount; s += 1) {
      sentences.push(hanSentence(random));
    }
    lines.push(sentences.join(""), "");
  }
  if (random() < 0.4) {
    lines.push(`> ${hanSentence(random)}`, "");
  }
  if (random() < 0.3) {
    lines.push("```ts", pickFrom(random, CODE_LINES), "```", "");
  }
  return lines.join("\n");
}

export function buildMixedMarkdown(random: DeterministicRandom): string {
  const lines: string[] = [];
  const lineCount = nextInt(random, 4, 9);
  for (let index = 0; index < lineCount; index += 1) {
    const [english, han] = pickFrom(random, MIXED_PAIRS);
    if (random() < 0.5) {
      lines.push(`${capitalize(english)} ${han}：${englishSentence(random)}`);
    } else {
      lines.push(`${hanTitle(random)}（${english}）${hanSentence(random)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function buildTinyMarkdown(random: DeterministicRandom): string {
  const lines = [englishSentence(random)];
  if (random() < 0.5) {
    lines.push(hanSentence(random));
  }
  return lines.join("\n");
}

function buildEnglishFillerBlock(random: DeterministicRandom): string {
  const sentences: string[] = [];
  const sentenceCount = nextInt(random, 5, 9);
  for (let index = 0; index < sentenceCount; index += 1) {
    sentences.push(englishSentence(random));
  }
  const block = sentences.join(" ");
  return random() < 0.2 ? `## ${englishTitle(random)}\n\n${block}` : block;
}

/**
 * Assembles an oversized Markdown note that lands close to `targetChars`
 * (UTF-16 code units). The head marker sits on an early line so it survives
 * the production 512KB slice; the tail marker sits on the final line so it is
 * dropped for over-cap documents.
 */
export function buildOversizedMarkdown(
  random: DeterministicRandom,
  targetChars: number,
  headMarker: string,
  tailMarker: string,
): string {
  const blocks: string[] = [];
  for (let index = 0; index < 48; index += 1) {
    blocks.push(buildEnglishFillerBlock(random));
  }

  const parts: string[] = ["# Oversized Benchmark Fixture", "", headMarker, ""];
  let length = parts.join("\n").length;
  let guard = 0;
  while (length < targetChars && guard < 200_000) {
    guard += 1;
    const block = pickFrom(random, blocks);
    parts.push(block, "");
    length += block.length + 1;
  }
  parts.push("", tailMarker);
  return parts.join("\n");
}

export function buildEnglishNeedleMarkdown(random: DeterministicRandom, needle: string): string {
  const lines = [
    "---",
    "tags: [reference]",
    "---",
    "",
    "# Marker Note For Query Regression",
    "",
    `The indexed token ${needle} must only appear in this document.`,
    "",
  ];
  const fillerCount = nextInt(random, 2, 4);
  for (let index = 0; index < fillerCount; index += 1) {
    lines.push(englishSentence(random), "");
  }
  return lines.join("\n");
}

export function buildHanNeedleMarkdown(random: DeterministicRandom, needle: string): string {
  const lines = [
    "---",
    "tags: [reference]",
    "---",
    "",
    "# 针标记笔记",
    "",
    `记录一个唯一的搜索词：${needle}。该词不应出现在其他任何笔记中。`,
    "",
  ];
  const fillerCount = nextInt(random, 2, 4);
  for (let index = 0; index < fillerCount; index += 1) {
    lines.push(hanSentence(random), "");
  }
  return lines.join("\n");
}
