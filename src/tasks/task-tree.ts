import { parseTaskLine } from "./task-line";
import type { ParsedTaskLine } from "./task-line";

/** Structural subset of Obsidian `ListItemCache`. `parent` is a line number; negative is a list root. */
export interface TaskListItemLike {
  readonly position: { readonly start: { readonly line: number } };
  readonly parent: number;
  readonly task?: string | undefined;
}

export interface TaskNode {
  readonly line: number;
  readonly lineText: string;
  readonly parsed: ParsedTaskLine;
  readonly children: readonly TaskNode[];
}

interface MutableNode {
  line: number;
  lineText: string;
  parsed: ParsedTaskLine;
  parentLine: number;
  children: MutableNode[];
}

export function splitContentLines(content: string): string[] {
  return content.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}

export function buildTaskTree(items: readonly TaskListItemLike[], content: string | readonly string[]): TaskNode[] {
  const lines = typeof content === "string" ? splitContentLines(content) : content;
  const itemsByLine = new Map<number, TaskListItemLike>();
  const nodes = new Map<number, MutableNode>();
  for (const item of items) {
    const line = item.position.start.line;
    if (!isLineNumber(line) || itemsByLine.has(line)) {
      continue;
    }
    itemsByLine.set(line, item);
    if (typeof item.task !== "string") {
      continue;
    }
    const lineText = line < lines.length ? lines[line] ?? "" : "";
    const parsed = parseTaskLine(lineText);
    if (parsed === null) {
      continue;
    }
    nodes.set(line, { line, lineText, parsed, parentLine: item.parent, children: [] });
  }

  const roots: MutableNode[] = [];
  const ordered = [...nodes.values()].sort((left, right) => left.line - right.line);
  for (const node of ordered) {
    const parentLine = nearestTaskAncestor(node, itemsByLine, nodes);
    const parent = parentLine === null ? undefined : nodes.get(parentLine);
    if (parent === undefined || parent === node) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots.map(toNode);
}

function nearestTaskAncestor(
  node: MutableNode,
  itemsByLine: ReadonlyMap<number, TaskListItemLike>,
  nodes: ReadonlyMap<number, MutableNode>,
): number | null {
  const seen = new Set<number>([node.line]);
  let current = node.parentLine;
  let nearest: number | null = null;
  while (isLineNumber(current)) {
    if (current === node.line) {
      return null;
    }
    if (seen.has(current)) {
      return nearest;
    }
    seen.add(current);
    if (nearest === null && nodes.has(current)) {
      nearest = current;
    }
    const ancestor = itemsByLine.get(current);
    if (ancestor === undefined) {
      return nearest;
    }
    current = ancestor.parent;
  }
  return nearest;
}

function toNode(node: MutableNode): TaskNode {
  const children = [...node.children].sort((left, right) => left.line - right.line).map(toNode);
  return { line: node.line, lineText: node.lineText, parsed: node.parsed, children };
}

function isLineNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
