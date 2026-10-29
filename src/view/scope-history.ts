import { validateScope, type CardScope } from "./scope";
import type { App } from "obsidian";
import type { CardBoxDefinition } from "./types";

/** Validate host state before routing it to the ordinary scope controller. */
export function readHistoryScope(value: unknown, app: App, boxes: CardBoxDefinition[]): CardScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as Partial<CardScope>;
  const validShape = scope.kind === "folder" ? typeof scope.path === "string" && typeof scope.includeSubfolders === "boolean"
    : scope.kind === "box" ? typeof scope.boxId === "string"
    : scope.kind === "links" ? typeof scope.notePath === "string" && (scope.direction === "backlinks" || scope.direction === "outgoing") : false;
  if (!validShape) return null;
  const result = scope as CardScope;
  return validateScope(app, result, boxes) ? { ...result } : null;
}
export function shouldRecordScopeHistory(source: string, changed: boolean, committed: boolean, queued: boolean): boolean {
  return changed && committed && !queued && source !== "links-follow" && source !== "history" && source !== "restore";
}
export interface ReadingPositionBridge {
  capture(): import("./scroll-anchoring").RowAnchor | null;
  restore(anchor: import("./scroll-anchoring").RowAnchor, scopeIdentity: string): void;
}
