import type { NavigationRow } from "./navigation-model";

interface NavigationHoverOptions {
  rows: readonly NavigationRow[];
  onChange: (rowIds: ReadonlySet<string>) => void;
}

function resolveHoverLineage(rows: readonly NavigationRow[], hoveredId: string | null): ReadonlySet<string> {
  const lineage = new Set<string>();
  let current = rows.find((candidate) => candidate.id === hoveredId);
  while (current) {
    if (current.id === hoveredId || current.kind === "folder" || current.kind === "tag") {
      lineage.add(current.id);
    }
    current = current.parentId
      ? rows.find((candidate) => candidate.id === current?.parentId)
      : undefined;
  }
  return lineage;
}

/** Preserves the legacy affordance where a hovered descendant keeps its ancestors' chevrons visible. */
export function navigationSubtreeHover(
  node: HTMLElement,
  initialOptions: NavigationHoverOptions,
): { update: (options: NavigationHoverOptions) => void; destroy: () => void } {
  let options = initialOptions;
  let hoveredId: string | null = null;
  const publish = (): void => options.onChange(resolveHoverLineage(options.rows, hoveredId));
  const over = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-nav-row-id]");
    hoveredId = target?.dataset.navRowId ?? null;
    publish();
  };
  const leave = (): void => { hoveredId = null; publish(); };
  node.addEventListener("pointerover", over);
  node.addEventListener("pointerleave", leave);
  publish();
  return {
    update: (nextOptions) => {
      options = nextOptions;
      if (hoveredId !== null && !options.rows.some((row) => row.id === hoveredId)) hoveredId = null;
      publish();
    },
    destroy: () => {
      node.removeEventListener("pointerover", over);
      node.removeEventListener("pointerleave", leave);
    },
  };
}
