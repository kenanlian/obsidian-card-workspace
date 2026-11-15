import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { ParsedTaskLine } from "../index";
import { isLivePreview, livePreviewToggled, visibleTaskLines } from "./editor-shared";

const hiddenDate = Decoration.replace({});

function lineHasSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function isInlineSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/**
 * Line-relative spans of the valid date tokens plus the spacing that separated
 * them, so no double space is left behind. A token takes the space before it;
 * tokens that open the task text take the space after them instead.
 */
function hiddenSpans(text: string, parsed: ParsedTaskLine): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let end = parsed.bodySpan.from;
  let leading = true;
  for (const token of parsed.dateTokens) {
    if (!token.valid) {
      continue;
    }
    let from = token.span.from;
    while (from > end && isInlineSpace(text[from - 1])) from -= 1;
    leading = leading && from === end;
    let to = token.span.to;
    if (leading) {
      while (to < text.length && isInlineSpace(text[to])) to += 1;
    }
    spans.push({ from, to });
    end = to;
  }
  return spans;
}

/**
 * Hides valid task date tokens in Live Preview, except on lines holding the
 * caret or touched by a selection. The trailing date buttons show the dates.
 */
export function createHiddenDateSource(): Extension {
  function build(view: EditorView): DecorationSet {
    if (!isLivePreview(view.state)) {
      return Decoration.none;
    }
    const ranges: Range<Decoration>[] = [];
    for (const { line, parsed } of visibleTaskLines(view)) {
      if (lineHasSelection(view.state, line.from, line.to)) {
        continue;
      }
      for (const span of hiddenSpans(line.text, parsed)) {
        ranges.push(hiddenDate.range(line.from + span.from, line.from + span.to));
      }
    }
    return Decoration.set(ranges, true);
  }

  const plugin = ViewPlugin.define((view) => ({
    decorations: build(view),
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || livePreviewToggled(update)) {
        this.decorations = build(update.view);
      }
    },
  }), {
    decorations: (value) => value.decorations,
    provide: (self) => EditorView.atomicRanges.of((view) => view.plugin(self)?.decorations ?? Decoration.none),
  });
  return plugin;
}
