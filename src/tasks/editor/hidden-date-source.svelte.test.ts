import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { createHiddenDateSource } from "./hidden-date-source";

const CREATED = "\u2795";
const DUE = "\u{1F4C5}";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren(); });

function mount(doc: string, livePreview = true): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [livePreview ? editorLivePreviewField.init(() => true) : [], createHiddenDateSource()],
    }),
  });
  views.push(view);
  return view;
}

const lineTexts = (view: EditorView) => Array.from(view.contentDOM.querySelectorAll(".cm-line")).map((line) => line.textContent);

function atomicSpans(view: EditorView): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    source(view).between(0, view.state.doc.length, (from, to) => { spans.push([from, to]); });
  }
  return spans;
}

describe("hidden task date source", () => {
  const doc = `- [ ] a ${CREATED} 2026-11-01 ${DUE} 2026-02-30\n- [ ] b ${DUE} 2026-11-20\nend`;

  it("hides valid date tokens and their spacing away from the caret", () => {
    const view = mount(doc);
    expect(lineTexts(view).slice(0, 2)).toEqual([`- [ ] a ${DUE} 2026-02-30`, "- [ ] b"]);
  });

  it("hides adjacent tokens and a leading token without overlapping ranges", () => {
    const leading = `- [ ] ${CREATED} 2026-11-01 ${DUE} 2026-11-20 task\nend`;
    const view = mount(leading);
    expect(lineTexts(view)[0]).toBe("- [ ] task");
    const spans = atomicSpans(view);
    expect(spans).toHaveLength(2);
    expect(spans[0]![1]).toBeLessThanOrEqual(spans[1]![0]);
  });

  it("reveals the source on lines holding the caret or touched by a selection", () => {
    const view = mount(doc);
    view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(lineTexts(view)[0]).toBe(`- [ ] a ${CREATED} 2026-11-01 ${DUE} 2026-02-30`);
    expect(lineTexts(view)[1]).toBe("- [ ] b");
    view.dispatch({ selection: EditorSelection.range(view.state.doc.line(2).to - 2, view.state.doc.length) });
    expect(lineTexts(view)[1]).toBe(`- [ ] b ${DUE} 2026-11-20`);
  });

  it("registers the hidden ranges, including their leading space, as atomic", () => {
    const view = mount(doc);
    const created = doc.indexOf(CREATED);
    const due = doc.indexOf(`${DUE} 2026-11-20`);
    expect(atomicSpans(view)).toEqual([[created - 1, created + CREATED.length + 11], [due - 1, due + DUE.length + 11]]);
  });

  it("does nothing outside Live Preview", () => {
    expect(lineTexts(mount(doc, false))[0]).toBe(`- [ ] a ${CREATED} 2026-11-01 ${DUE} 2026-02-30`);
  });
});
