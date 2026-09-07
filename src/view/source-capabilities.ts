import type { GroupDimension } from "../card-grouping-settings";
import type { CardScope } from "./scope";

/**
 * The one exhaustive Folder/Box capability table (C6).
 *
 * Every consumer that needs "does this source support X" policy — arrangement
 * ownership, browse filter availability, include-subfolders controls, Box rule
 * seeding, projection-group dimensions — resolves it here instead of inferring
 * Folder behavior from `activeBoxId === null` or a generic `isBoxMode`.
 * Scope identity, validation, candidate collection, and pipeline-step dispatch
 * stay their own exhaustive switches because they perform behavior, not
 * capability lookup. A later source kind must extend this switch together with
 * the semantic dispatchers; the `never` arm fails compilation otherwise.
 */
export interface SourceCapabilities {
  readonly arrangementOwner:
    | { readonly kind: "global" }
    | { readonly kind: "box"; readonly boxId: string };
  readonly browseTagFilter: boolean;
  readonly browsePropertyFilter: boolean;
  readonly supportsIncludeSubfolders: boolean;
  readonly supportsBoxRuleSeeding: boolean;
  readonly groupDimensions: readonly GroupDimension[];
}

/** Grouping dimensions offered in folder scope; `box-rule` needs a box's rule list. */
export const FOLDER_GROUP_DIMENSIONS: readonly GroupDimension[] = ["none", "folder", "tag", "task"];

/** Grouping dimensions offered in box scope, including the box's own rules. */
export const BOX_GROUP_DIMENSIONS: readonly GroupDimension[] = [
  "none",
  "folder",
  "tag",
  "box-rule",
  "task",
];

export function resolveSourceCapabilities(scope: CardScope): SourceCapabilities {
  switch (scope.kind) {
    case "folder":
      return {
        arrangementOwner: { kind: "global" },
        browseTagFilter: true,
        browsePropertyFilter: true,
        supportsIncludeSubfolders: true,
        supportsBoxRuleSeeding: true,
        groupDimensions: FOLDER_GROUP_DIMENSIONS,
      };
    case "box":
      return {
        arrangementOwner: { kind: "box", boxId: scope.boxId },
        browseTagFilter: false,
        browsePropertyFilter: false,
        supportsIncludeSubfolders: false,
        supportsBoxRuleSeeding: false,
        groupDimensions: BOX_GROUP_DIMENSIONS,
      };
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}
