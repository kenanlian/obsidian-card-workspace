import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { getUiStrings } from "../../i18n";
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
      extensions: [livePreview ? editorLivePreviewField.init(() => true) : [], createHiddenDateSource({ getStrings: () => getUiStrings("en").tasks })],
    }),
  });
  views.push(view);
  return view;
}

const lineTexts = (view: EditorView) => Array.from(view.contentDOM.querySelectorAll(".cm-line")).map((line) => line.textContent);

describe("hidden task date source", () => {
  const doc = `- [ ] a ${CREATED} 2026-11-01 ${DUE} 2026-02-30\n- [ ] b ${DUE} 2026-11-20\nend`;

  it("replaces valid date tokens with dots away from the caret", () => {
    const view = mount(doc);
    const dots = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".fce-task-date-dot"));
    expect(dots.map((dot) => [dot.dataset.kind, dot.getAttribute("aria-label")])).toEqual([
      ["created", "Created date: 2026-11-01"],
      ["due", "Due date: 2026-11-20"],
    ]);
    expect(lineTexts(view).slice(0, 2)).toEqual([`- [ ] a  ${DUE} 2026-02-30`, "- [ ] b "]);
  });

  it("reveals the source on lines holding the caret or touched by a selection", () => {
    const view = mount(doc);
    view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(lineTexts(view)[0]).toBe(`- [ ] a ${CREATED} 2026-11-01 ${DUE} 2026-02-30`);
    expect(view.contentDOM.querySelectorAll(".fce-task-date-dot")).toHaveLength(1);
    view.dispatch({ selection: EditorSelection.range(view.state.doc.line(2).to - 2, view.state.doc.length) });
    expect(view.contentDOM.querySelectorAll(".fce-task-date-dot")).toHaveLength(1);
    expect(lineTexts(view)[1]).toBe(`- [ ] b ${DUE} 2026-11-20`);
  });

  it("registers the replaced ranges as atomic", () => {
    const view = mount(doc);
    const ranges = view.state.facet(EditorView.atomicRanges).map((source) => source(view));
    const spans: Array<[number, number]> = [];
    for (const set of ranges) set.between(0, view.state.doc.length, (from, to) => { spans.push([from, to]); });
    const created = doc.indexOf(CREATED);
    const due = doc.indexOf(`${DUE} 2026-11-20`);
    expect(spans).toEqual([[created, created + CREATED.length + 11], [due, due + DUE.length + 11]]);
  });

  it("does nothing outside Live Preview", () => {
    expect(mount(doc, false).contentDOM.querySelectorAll(".fce-task-date-dot")).toHaveLength(0);
  });
});
