import { serializePropertyScalarRef } from "../../property-filter-settings";
import { buildPropertyFacets } from "../property-facets";
import { getFileFrontmatter } from "../metadata-utils";
import { orderPropertyNavigation } from "../property-navigation-projection";
import { resolveNewNoteFolderPath } from "../scope";
import type { ViewContext } from "../view-context";

export interface ScopeNoteActionsDeps {
  context: ViewContext;
  createNote: (folderPath: string, tags: string[], properties: Record<string, string | number | boolean>, boxId?: string) => Promise<void>;
}

/** Capture the committed source and complete filter ordering before any await. */
export class ScopeNoteActions {
  constructor(private readonly deps: ScopeNoteActionsDeps) {}

  createNote(): Promise<void> {
    const { context } = this.deps;
    const scope = context.store.getScope();
    const settings = context.getSettings();
    const folderPath = resolveNewNoteFolderPath(scope, settings.lastFolderPath, settings.boxNewNoteFolderPath);
    const tags = scope.kind === "folder" ? [...settings.filter.tags] : [];
    const properties: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
    if (scope.kind === "folder") {
      const clauses = settings.filter.properties;
      const facets = buildPropertyFacets(context.store.getBaseCards(), clauses.map((clause) => clause.key), clauses,
        (file) => getFileFrontmatter(context.getApp(), file), context.getUiStrings().property);
      for (const facet of orderPropertyNavigation(facets, settings.navigationSorting)) {
        const selected = new Set(clauses.find((clause) => clause.key === facet.key)?.values.map(serializePropertyScalarRef));
        const ref = facet.values.find((value) => value.ref.kind !== "missing" && selected.has(serializePropertyScalarRef(value.ref)))?.ref;
        if (ref && ref.kind !== "missing" && facet.key !== "tags" && facet.key !== "tag") properties[facet.label] = ref.value;
      }
    }
    return scope.kind === "box"
      ? this.deps.createNote(folderPath, tags, properties, scope.boxId)
      : this.deps.createNote(folderPath, tags, properties);
  }
}
