export interface TagTreeNode {
  tag: string;
  displayTag: string;
  label: string;
  depth: number;
  synthetic: boolean;
  children: TagTreeNode[];
}

export interface VisibleTagTreeNode {
  tag: string;
  displayTag: string;
  label: string;
  depth: number;
  synthetic: boolean;
  hasChildren: boolean;
}

interface MutableTagTreeNode {
  tag: string;
  displayTag: string;
  label: string;
  depth: number;
  synthetic: boolean;
  children: MutableTagTreeNode[];
}

function getDisplayTagSegments(value: string): string[] {
  return value
    .trim()
    .replace(/^#/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function shouldReplaceDisplayCandidate(
  currentDisplayTag: string,
  nextDisplayTag: string,
  currentIsExact: boolean,
  nextIsExact: boolean,
): boolean {
  if (nextIsExact !== currentIsExact) {
    return nextIsExact;
  }

  return nextDisplayTag < currentDisplayTag;
}

export function normalizeTagPath(value: string): string {
  return value
    .trim()
    .replace(/^#/, "")
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
    .join("/");
}

export function buildTagTree(tags: string[]): TagTreeNode[] {
  const roots: MutableTagTreeNode[] = [];
  const nodesByTag = new Map<string, MutableTagTreeNode>();
  const exactDisplayByTag = new Map<string, boolean>();

  for (const rawTag of tags) {
    const normalizedTag = normalizeTagPath(rawTag);
    const displaySegments = getDisplayTagSegments(rawTag);
    if (normalizedTag.length === 0 || displaySegments.length === 0) {
      continue;
    }

    const segments = normalizedTag.split("/");
    let parent: MutableTagTreeNode | null = null;

    for (let index = 0; index < segments.length; index += 1) {
      const tag = segments.slice(0, index + 1).join("/");
      let node = nodesByTag.get(tag);

      if (!node) {
        node = {
          tag,
          displayTag: displaySegments.slice(0, index + 1).join("/"),
          label: displaySegments[index],
          depth: index,
          synthetic: true,
          children: [],
        };
        nodesByTag.set(tag, node);

        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }

      const nextDisplayTag = displaySegments.slice(0, index + 1).join("/");
      const nextIsExact = index === segments.length - 1;
      const currentIsExact = exactDisplayByTag.get(tag) ?? false;

      if (shouldReplaceDisplayCandidate(node.displayTag, nextDisplayTag, currentIsExact, nextIsExact)) {
        node.displayTag = nextDisplayTag;
        node.label = displaySegments[index];
      }

      if (nextIsExact) {
        node.synthetic = false;
        exactDisplayByTag.set(tag, true);
      }

      parent = node;
    }
  }

  const sortNodes = (nodes: MutableTagTreeNode[]): void => {
    nodes.sort((left, right) => left.tag.localeCompare(right.tag));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return roots;
}

export function collectExpandableTagPaths(nodes: TagTreeNode[]): string[] {
  const expandablePaths: string[] = [];

  const walk = (items: TagTreeNode[]): void => {
    for (const node of items) {
      if (node.children.length > 0) {
        expandablePaths.push(node.tag);
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return expandablePaths;
}

export function flattenVisibleTagTree(nodes: TagTreeNode[], expandedTags: Set<string>): VisibleTagTreeNode[] {
  const visibleNodes: VisibleTagTreeNode[] = [];

  const walk = (items: TagTreeNode[]): void => {
    for (const node of items) {
      visibleNodes.push({
        tag: node.tag,
        displayTag: node.displayTag,
        label: node.label,
        depth: node.depth,
        synthetic: node.synthetic,
        hasChildren: node.children.length > 0,
      });

      if (node.children.length > 0 && expandedTags.has(node.tag)) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return visibleNodes;
}

export function tagPathMatchesFilter(fileTag: string, filterTag: string): boolean {
  const normalizedFileTag = normalizeTagPath(fileTag);
  const normalizedFilterTag = normalizeTagPath(filterTag);

  if (normalizedFileTag.length === 0 || normalizedFilterTag.length === 0) {
    return false;
  }

  return normalizedFileTag === normalizedFilterTag || normalizedFileTag.startsWith(`${normalizedFilterTag}/`);
}
