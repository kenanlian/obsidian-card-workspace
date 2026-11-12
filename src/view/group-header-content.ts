import type { SortGroupStrings } from "../i18n";

export type GroupHeaderPropertyValue =
  | { readonly kind: "text" | "number"; readonly label: string }
  | { readonly kind: "boolean"; readonly value: boolean; readonly label: string };

/**
 * Structured header content. A bucket's flat `label` stays the form used for
 * ordering, the accessible name, and tooltips; this is only what the header
 * renders. An empty `tags` list is the no-tag bucket and a property header
 * with no `values` is the unassigned bucket; both render the flat label.
 * `text` is the kind-less fallback for a card missing from the bucket map.
 */
export type GroupHeaderContent =
  | { readonly kind: "time"; readonly field: "ctime" | "mtime"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "folder"; readonly name: string; readonly path: string }
  | { readonly kind: "tags"; readonly tags: readonly string[] }
  | {
      readonly kind: "property";
      readonly keyLabel: string;
      readonly values: readonly GroupHeaderPropertyValue[];
    }
  | { readonly kind: "task"; readonly text: string }
  | { readonly kind: "box-rule"; readonly text: string };

export interface GroupHeaderChip {
  readonly text: string;
  readonly prefix?: string;
  readonly icon?: string;
  readonly iconOff?: boolean;
  readonly title?: string;
}

export interface GroupHeaderDimension {
  readonly icon: string;
  readonly label: string;
}

export interface GroupHeaderParts {
  readonly dimension: GroupHeaderDimension | null;
  readonly chips: readonly GroupHeaderChip[];
}

function toTagChip(tag: string): GroupHeaderChip {
  const cut = tag.lastIndexOf("/");
  return cut === -1 ? { text: tag } : { text: tag.slice(cut + 1), prefix: tag.slice(0, cut + 1) };
}

function toPropertyChip(value: GroupHeaderPropertyValue): GroupHeaderChip {
  return value.kind === "boolean"
    ? { text: value.label, icon: value.value ? "check-square" : "square", iconOff: !value.value }
    : { text: value.label };
}

/** Shapes any header into the shared "kind | value chips" layout. */
export function resolveGroupHeaderParts(
  header: GroupHeaderContent,
  fallbackLabel: string,
  strings: SortGroupStrings,
): GroupHeaderParts {
  switch (header.kind) {
    case "time":
      return { dimension: { icon: header.field === "ctime" ? "file-plus-2" : "file-clock",
        label: header.field === "ctime" ? strings.dimensionCtime : strings.dimensionMtime }, chips: [{ text: header.text }] };
    case "folder":
      return {
        dimension: { icon: "folder", label: strings.dimensionFolder },
        chips: [{ text: header.name, title: header.path || header.name }],
      };
    case "tags":
      return {
        dimension: { icon: "tag", label: strings.dimensionTag },
        chips: header.tags.length === 0 ? [{ text: fallbackLabel }] : header.tags.map(toTagChip),
      };
    case "property":
      return {
        dimension: { icon: "list", label: header.keyLabel },
        chips: header.values.length === 0 ? [{ text: fallbackLabel }] : header.values.map(toPropertyChip),
      };
    case "task":
      return {
        dimension: { icon: "list-checks", label: strings.dimensionTask },
        chips: [{ text: header.text }],
      };
    case "box-rule":
      return {
        dimension: { icon: "package-check", label: strings.dimensionBoxRule },
        chips: [{ text: header.text }],
      };
    case "text":
      return { dimension: null, chips: [{ text: header.text }] };
  }
}
