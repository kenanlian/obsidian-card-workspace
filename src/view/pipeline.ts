import type { App } from "obsidian";
import type { NoteCardRecord } from "./types";
import type { PluginSettings } from "../settings";

export interface PipelineContext {
  app: App;
  settings: PluginSettings;
}

export type PipelineStep = (
  cards: NoteCardRecord[],
  context: PipelineContext,
) => NoteCardRecord[];

export function runPipeline(
  cards: NoteCardRecord[],
  steps: PipelineStep[],
  context: PipelineContext,
): NoteCardRecord[] {
  let result = cards;
  for (const step of steps) {
    result = step(result, context);
  }
  return result;
}

/** Tag filter step — pass-through until Task 14 implements filtering. */
export function applyTagFilter(cards: NoteCardRecord[], _context: PipelineContext): NoteCardRecord[] {
  return cards;
}

/** Search filter step — pass-through until Task 22/27 implement search. */
export function applySearchFilter(cards: NoteCardRecord[], _context: PipelineContext): NoteCardRecord[] {
  return cards;
}

/** Pin reorder step — pass-through until Task 17 implements pinning. */
export function applyPinReorder(cards: NoteCardRecord[], _context: PipelineContext): NoteCardRecord[] {
  return cards;
}

export const DEFAULT_PIPELINE_STEPS: PipelineStep[] = [
  applyTagFilter,
  applySearchFilter,
  applyPinReorder,
];
