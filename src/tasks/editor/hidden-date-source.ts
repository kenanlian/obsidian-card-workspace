import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { TaskStrings } from "../../i18n/tasks";
import type { TaskDateKind } from "../index";
import { isLivePreview, livePreviewToggled, visibleTaskLines } from "./editor-shared";

export interface HiddenDateSourceOptions {
  readonly getStrings: () => TaskStrings;
}

class DateDotWidget extends WidgetType {
  constructor(private readonly kind: TaskDateKind, private readonly value: string, private readonly label: string) {
    super();
  }

  eq(other: DateDotWidget): boolean {
    return other.kind === this.kind && other.value === this.value && other.label === this.label;
  }

  toDOM(view: EditorView): HTMLElement {
    return view.dom.ownerDocument.defaultView!.createFragment().createSpan({
      cls: "fce-task-date-dot",
      attr: { "data-kind": this.kind, "aria-label": this.label },
    });
  }

  /** A click places the caret, which reveals the source on that line. */
  ignoreEvent(): boolean {
    return false;
  }
}

function lineHasSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Experimental: replaces valid task date tokens with dots in Live Preview,
 * except on lines holding the caret or touched by a selection.
 */
export function createHiddenDateSource(options: HiddenDateSourceOptions): Extension {
  function build(view: EditorView): DecorationSet {
    if (!isLivePreview(view.state)) {
      return Decoration.none;
    }
    const strings = options.getStrings();
    const ranges: Range<Decoration>[] = [];
    for (const { line, parsed } of visibleTaskLines(view)) {
      if (lineHasSelection(view.state, line.from, line.to)) {
        continue;
      }
      for (const token of parsed.dateTokens) {
        if (!token.valid) {
          continue;
        }
        const label = strings.editor.dateButtonLabel(strings.datePicker.kinds[token.kind], token.value);
        ranges.push(Decoration.replace({ widget: new DateDotWidget(token.kind, token.value, label) })
          .range(line.from + token.span.from, line.from + token.span.to));
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
