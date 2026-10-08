import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, tick } from "svelte";
import CardItem from "./CardItem.svelte";
import { getUiStrings } from "../i18n";
import type { CardFileKind } from "./file-kind";
import type { CardHoverLinkPayload, NoteCardRecord } from "./types";
import {
  highlightSanitizedPreviewHtml,
  sanitizePreviewHtml,
} from "./preview-html";
import { buildLightPreview } from "./markdown-utils";
import { createSearchPreviewMatcher, extractSearchPreviewSnippets } from "../search";

interface OpenNotePayload {
  path: string;
  snippetId?: string;
}

interface PinTogglePayload {
  path: string;
  pinned: boolean;
}

interface CardContextMenuPayload {
  path: string;
  mouseEvent?: MouseEvent;
  trigger?: "button";
  position?: { x: number; y: number };
}

interface BulkSelectCardPayload {
  path: string;
  shiftKey: boolean;
}

interface CardItemCallbacks {
  onOpenNote?: (payload: OpenNotePayload) => void;
  onPinToggle?: (payload: PinTogglePayload) => void;
  onCardContextMenu?: (payload: CardContextMenuPayload) => void;
  onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
  onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
  onToggleReferences?: (payload: { path: string }) => void;
  onImageReveal?: (payload: import("./image-request").CardImageRevealRequest) => boolean;
}

interface CapturedCallbacks {
  callbacks: CardItemCallbacks;
  openEvents: OpenNotePayload[];
  pinEvents: PinTogglePayload[];
  contextEvents: CardContextMenuPayload[];
  bulkEvents: BulkSelectCardPayload[];
  hoverEvents: CardHoverLinkPayload[];
}

interface MountedCardItem {
  component: Record<string, unknown>;
  target: HTMLDivElement;
}

let mountedComponents: Array<Record<string, unknown>> = [];

interface CreateCardOptions {
  fileKind?: CardFileKind;
  title?: string;
  previewHtml?: string;
  previewMode?: NoteCardRecord["previewMode"];
  excerpt?: string;
  taskSummary?: NoteCardRecord["taskSummary"];
}

function createCard(path: string = "notes/a.md", options: CreateCardOptions = {}): NoteCardRecord {
  const {
    fileKind = "markdown",
    title = "A note",
    previewHtml = "<p>Preview text</p>",
    previewMode = "text",
    excerpt = "excerpt",
    taskSummary = null,
  } = options;

  return {
    file: {} as never,
    fileKind,
    path,
    title,
    ctime: new Date("2024-01-02T10:00:00Z").getTime(),
    mtime: new Date("2024-02-03T12:00:00Z").getTime(),
    excerpt,
    previewHtml,
    previewMode,
    hydrated: true,
    taskSummary,
  };
}

function getExcerptHtml(target: HTMLDivElement): string {
  return target.querySelector<HTMLElement>(".fce-excerpt")?.innerHTML ?? "";
}

async function searchCard(query: string, text: string, options: CreateCardOptions = {}, lines = 5, snippetLimit = 2): Promise<NoteCardRecord> {
  const card = createCard("notes/search.md", options);
  const snippets = (await extractSearchPreviewSnippets(text, {
    limit: snippetLimit, idPrefix: "fixture", matcher: createSearchPreviewMatcher(query),
  }))!;
  card.searchPreview = { query, revision: 1, mtime: card.mtime, previewLines: lines, snippetLimit, status: snippets.length ? "hits" : "unavailable", snippets };
  return card;
}

function createCapturedCallbacks(): CapturedCallbacks {
  const openEvents: OpenNotePayload[] = [];
  const pinEvents: PinTogglePayload[] = [];
  const contextEvents: CardContextMenuPayload[] = [];
  const bulkEvents: BulkSelectCardPayload[] = [];
  const hoverEvents: CardHoverLinkPayload[] = [];

  return {
    callbacks: {
      onOpenNote: (payload: OpenNotePayload) => {
        openEvents.push(payload);
      },
      onPinToggle: (payload: PinTogglePayload) => {
        pinEvents.push(payload);
      },
      onCardContextMenu: (payload: CardContextMenuPayload) => {
        contextEvents.push(payload);
      },
      onBulkSelectCard: (payload: BulkSelectCardPayload) => {
        bulkEvents.push(payload);
      },
      onCardHoverLink: (payload: CardHoverLinkPayload) => {
        hoverEvents.push(payload);
      },
    },
    openEvents,
    pinEvents,
    contextEvents,
    bulkEvents,
    hoverEvents,
  };
}

function mountCardItem(
  props: Record<string, unknown> = {},
  callbacks: CardItemCallbacks = {},
): MountedCardItem {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const values = props as Record<string, any>;
  const defaultStrings = getUiStrings("en");
  const component = mount(CardItem, {
    target,
    props: {
      card: values.card ?? createCard(),
      strings: values.strings
        ? { ...defaultStrings, cardItem: values.strings }
        : defaultStrings,
      appearance: values.appearance ?? {
        cardCornerRadius: values.cardCornerRadius ?? "compact",
        previewLines: values.previewLines ?? 5,
        searchPreviewSnippetCount: values.searchPreviewSnippetCount ?? 2,
        cardImageMode: values.cardImageMode ?? "off",
        cardImageFit: values.cardImageFit ?? "contain",
      },
      image: values.image,
      selected: values.selected ?? false,
      bulkMode: values.bulkMode ?? false,
      bulkSelected: values.bulkSelected ?? false,
      pinnedPaths: values.pinnedPaths ?? [],
      searchQuery: values.searchQuery ?? "",
      searchMatchCount: values.searchMatchCount ?? 0,
      previewHtmlSanitizer: values.previewHtmlSanitizer,
      ...callbacks,
    },
  });
  mountedComponents.push(component);

  return { component, target };
}

async function disposeMountedComponent(component: Record<string, unknown>): Promise<void> {
  mountedComponents = mountedComponents.filter((candidate) => candidate !== component);
  await unmount(component);
}

describe("CardItem.svelte", () => {
  beforeEach(() => {
    mountedComponents = [];
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await Promise.all(mountedComponents.map((component) => unmount(component)));
    vi.restoreAllMocks();
    mountedComponents = [];
    document.body.innerHTML = "";
  });

  it.each([false, true])("hides ordinary previews at zero lines (hydrated: %s)", async (hydrated) => {
    const { target } = mountCardItem({ previewLines: 0, card: { ...createCard(), hydrated } });
    await tick();
    expect(target.querySelector(".fce-excerpt")).toBeNull();
    expect(target.querySelector("h4")).not.toBeNull();
  });

  function referenceCard(direction: "backlinks" | "outgoing" = "backlinks", expanded = false): NoteCardRecord {
    return { ...createCard(), referenceCount: 5, linkPreview: {
      direction, expanded, status: "ready", sourcePath: "source.md", sourceMtime: 1, sourceRevision: 0, contextKey: "context",
      totalSnippets: 5, snippets: Array.from({ length: expanded ? 5 : 3 }, (_, index) => ({
        id: `reference-${index}`, text: `Context ${index} <img src=x>`, ...buildLightPreview(`Context ${index} <img src=x>`), referenceCount: index === 0 ? 2 : 1,
        location: { line: index * 2, identity: `location-${index}` },
        targetLocation: direction === "outgoing" ? { line: index, identity: `target-${index}` } : undefined,
      })),
    } };
  }

  it("renders the occurrence badge, merged contexts and the remaining-context control safely", async () => {
    const onOpenNote = vi.fn(), onToggleReferences = vi.fn();
    const card = referenceCard();
    const { target } = mountCardItem({ card }, { onOpenNote, onToggleReferences });
    await tick();
    expect(target.querySelector(".fce-card-reference-count")?.textContent).toBe("5 references");
    expect(target.querySelectorAll(".fce-reference-snippet")).toHaveLength(3);
    expect(target.querySelector(".fce-excerpt")?.classList.contains("fce-reference-list")).toBe(true);
    expect(target.textContent).not.toContain("Preview text");
    expect(target.querySelector(".fce-reference-paragraph-count")?.textContent).toContain("2 references");
    expect(target.querySelector(".fce-reference-list img")).toBeNull();
    target.querySelector<HTMLButtonElement>(".fce-reference-snippet")!.click();
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith({ path: card.path, referenceId: "reference-0", referenceTarget: false });
    const toggle = target.querySelector<HTMLButtonElement>(".fce-references-toggle")!;
    expect(toggle.textContent).toContain("Show 2 more contexts");
    toggle.click();
    expect(onToggleReferences).toHaveBeenCalledExactlyOnceWith({ path: card.path });
    expect(onOpenNote).toHaveBeenCalledTimes(1);
  });

  it("shows outgoing reference content directly and emits distinct source and target clicks", async () => {
    const onOpenNote = vi.fn();
    const card = referenceCard("outgoing", true);
    const { target } = mountCardItem({ card }, { onOpenNote });
    await tick();
    expect(target.querySelector(".fce-excerpt")?.textContent).toContain("Context 0");
    expect(target.textContent).not.toContain("Preview text");
    const snippet = target.querySelector<HTMLButtonElement>(".fce-reference-snippet")!;
    snippet.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    target.querySelector<HTMLButtonElement>(".fce-reference-target")!.click();
    expect(onOpenNote.mock.calls).toEqual([
      [{ path: card.path, referenceId: "reference-0", referenceTarget: false }],
      [{ path: card.path, referenceId: "reference-0", referenceTarget: true }],
    ]);
    expect(target.querySelector(".fce-references-toggle")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders destination content with the regular preview classes and opens the shown target on click", async () => {
    const onOpenNote = vi.fn();
    const card = referenceCard("outgoing");
    const preview = buildLightPreview("# Target\nReferenced `code`\n- [ ] readonly task");
    card.linkPreview = { ...card.linkPreview!, totalSnippets: 1, snippets: [{
      ...card.linkPreview!.snippets[0], ...preview, text: "Target referenced code", displayTarget: true,
    }] };
    const { target } = mountCardItem({ card }, { onOpenNote });
    await tick();
    expect(target.querySelector(".fce-excerpt .fce-preview-heading")?.textContent).toBe("Target");
    expect(target.querySelector(".fce-excerpt code")?.textContent).toBe("code");
    expect(target.querySelector(".fce-excerpt .fce-preview-task")).not.toBeNull();
    expect(target.querySelector("blockquote")).toBeNull();
    expect(target.textContent).not.toContain("Preview text");
    expect(target.querySelector(".fce-reference-target")).toBeNull();
    target.querySelector<HTMLButtonElement>(".fce-reference-snippet")!.click();
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith({ path: card.path, referenceId: "reference-0", referenceTarget: true });
  });

  it("keeps title-only link search previews on the referenced content", async () => {
    const card = referenceCard();
    card.searchPreview = { query: "title", revision: 1, mtime: card.mtime, previewLines: 5, snippetLimit: 2, status: "title-only", snippets: [] };
    const { target } = mountCardItem({ card, searchQuery: "title" });
    await tick();
    expect(target.querySelectorAll(".fce-reference-snippet")).toHaveLength(3);
    expect(target.textContent).not.toContain("Preview text");
  });

  it("renders plain outgoing links with the ordinary opening preview and its configured line budget", async () => {
    const onOpenNote = vi.fn();
    const card = referenceCard("outgoing");
    const preview = buildLightPreview("Opening text\nSecond line\nThird line\nFourth line\nFifth line", undefined, 5);
    card.linkPreview = { ...card.linkPreview!, totalSnippets: 1, snippets: [{
      ...card.linkPreview!.snippets[0], ...preview, text: "Opening text", displayTarget: true, openingPreview: true,
    }] };
    const { target } = mountCardItem({ card, previewLines: 5 }, { onOpenNote });
    await tick();
    const opening = target.querySelector<HTMLButtonElement>(".fce-reference-snippet.is-opening")!;
    expect(opening.querySelector(".fce-reference-content")).toBeNull();
    expect(opening.querySelector<HTMLElement>(".fce-excerpt")?.style.getPropertyValue("--fce-preview-line-clamp")).toBe("5");
    expect(opening.textContent).toContain("Fifth line");
    opening.click();
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith({ path: card.path, referenceId: "reference-0", referenceTarget: true });
  });

  it("keeps search as the primary preview and preserves expansion after a component remount", async () => {
    const card = referenceCard();
    const first = mountCardItem({ card, searchQuery: "query" });
    await tick();
    expect(first.target.querySelector(".fce-excerpt")).not.toBeNull();
    expect(first.target.querySelector(".fce-reference-list")).toBeNull();
    await disposeMountedComponent(first.component);
    const next = mountCardItem({ card: referenceCard("backlinks", true) });
    await tick();
    expect(next.target.querySelectorAll(".fce-reference-snippet")).toHaveLength(5);
    expect(next.target.querySelector(".fce-references-toggle")?.textContent).toContain("Collapse references");
  });

  it("routes reference clicks to bulk selection while bulk mode is active", async () => {
    const onOpenNote = vi.fn(), onBulkSelectCard = vi.fn();
    const card = referenceCard();
    const { target } = mountCardItem({ card, bulkMode: true }, { onOpenNote, onBulkSelectCard });
    await tick();
    target.querySelector<HTMLButtonElement>(".fce-reference-snippet")!.click();
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(onBulkSelectCard).toHaveBeenCalledExactlyOnceWith({ path: card.path, shiftKey: false });
  });

  it("handles reference keyboard events from another window without opening on Tab", async () => {
    const onOpenNote = vi.fn();
    const { target } = mountCardItem({ card: referenceCard() }, { onOpenNote });
    const iframe = document.createElement("iframe"); document.body.appendChild(iframe);
    const ForeignKeyboardEvent = (iframe.contentWindow as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
    await tick();
    const button = target.querySelector<HTMLButtonElement>(".fce-reference-snippet")!;
    button.dispatchEvent(new ForeignKeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(onOpenNote).not.toHaveBeenCalled();
    button.dispatchEvent(new ForeignKeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onOpenNote).toHaveBeenCalledTimes(1);
  });

  it.each(["right", "inline"])("renders %s images with click/drag behavior and a stable failure region", async (cardImageMode) => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ cardImageMode, cardImageFit: "cover", image: { status: "ready", url: "blob:thumbnail" } }, captured.callbacks);
    await tick();
    const image = target.querySelector("img")!;
    expect(image.draggable).toBe(false);
    expect(target.querySelector(".fce-card-image")?.classList.contains("is-inline")).toBe(cardImageMode === "inline");
    expect(target.querySelector(".fce-card-image")?.classList.contains("is-cover")).toBe(true);
    image.dispatchEvent(new MouseEvent("click", { bubbles: true })); expect(captured.openEvents).toHaveLength(1);
    image.dispatchEvent(new Event("error")); await tick();
    expect(target.querySelector(".fce-card-image")).not.toBeNull();
    expect(target.querySelector(".fce-card-image-placeholder")?.getAttribute("aria-label")).toBe("Image unavailable");
  });
  it("reveals image pixels only after decoding finishes", async () => {
    const onImageReveal = vi.fn(() => true);
    const { target } = mountCardItem({ cardImageMode: "inline", image: { status: "ready", url: "blob:thumbnail" } }, { onImageReveal });
    await tick();
    const image = target.querySelector("img")!;
    let finishDecode!: () => void;
    image.decode = vi.fn(() => new Promise<void>((resolve) => { finishDecode = resolve; }));
    image.dispatchEvent(new Event("load")); await tick();
    expect(image.classList.contains("is-loaded")).toBe(false);
    expect(onImageReveal).not.toHaveBeenCalled();
    finishDecode(); await tick();
    expect(image.classList.contains("is-loaded")).toBe(true);
    expect(image.classList.contains("is-revealing")).toBe(true);
    expect(onImageReveal).toHaveBeenCalledExactlyOnceWith({ path: "notes/a.md", url: "blob:thumbnail" });
  });
  it("shows a remounted image without animating when its fingerprint was already revealed", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(88);
    const onImageReveal = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const first = mountCardItem({ cardImageMode: "right", image: { status: "ready", url: "blob:first" } }, { onImageReveal });
    await tick(); expect(first.target.querySelector("img")?.classList.contains("is-revealing")).toBe(true);
    await disposeMountedComponent(first.component);
    const second = mountCardItem({ cardImageMode: "right", image: { status: "ready", url: "blob:second" } }, { onImageReveal });
    await tick();
    expect(second.target.querySelector("img")?.classList.contains("is-loaded")).toBe(true);
    expect(second.target.querySelector("img")?.classList.contains("is-revealing")).toBe(false);
    expect(onImageReveal).toHaveBeenLastCalledWith({ path: "notes/a.md", url: "blob:second" });
  });
  it("does not record a reveal when decoding finishes after virtual unmount", async () => {
    const onImageReveal = vi.fn(() => true);
    const { target, component } = mountCardItem({ cardImageMode: "inline", image: { status: "ready", url: "blob:thumbnail" } }, { onImageReveal });
    await tick();
    const image = target.querySelector("img")!;
    let finishDecode!: () => void;
    image.decode = vi.fn(() => new Promise<void>((resolve) => { finishDecode = resolve; }));
    image.dispatchEvent(new Event("load"));
    await disposeMountedComponent(component); finishDecode(); await tick();
    expect(onImageReveal).not.toHaveBeenCalled();
  });
  it("reveals already cached images even when no load event follows mounting", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(88);
    const { target } = mountCardItem({ cardImageMode: "right", image: { status: "ready", url: "blob:cached" } });
    await tick();
    expect(target.querySelector("img")?.classList.contains("is-loaded")).toBe(true);
  });
  it("shows a blank loading region and preserves it when decoding fails", async () => {
    const onImageReveal = vi.fn(() => true);
    const loading = mountCardItem({ cardImageMode: "inline", image: { status: "loading" } });
    const ready = mountCardItem({ cardImageMode: "inline", image: { status: "ready", url: "blob:broken" } }, { onImageReveal });
    await tick();
    expect(loading.target.querySelector(".fce-card-image-placeholder")?.children).toHaveLength(0);
    const region = ready.target.querySelector(".fce-card-image"), image = ready.target.querySelector("img")!;
    image.decode = vi.fn(async () => { throw new Error("decode failed"); });
    image.dispatchEvent(new Event("load")); await tick();
    expect(ready.target.querySelector(".fce-card-image")).toBe(region);
    expect(ready.target.querySelector(".fce-card-image-placeholder")?.getAttribute("aria-label")).toBe("Image unavailable");
    expect(onImageReveal).not.toHaveBeenCalled();
  });
  it("omits the image region for off and no-image cards", async () => {
    const off = mountCardItem({ image: { status: "ready", url: "blob:thumbnail" } });
    const noImage = mountCardItem({ cardImageMode: "inline" }); await tick();
    expect(off.target.querySelector(".fce-card-image")).toBeNull(); expect(noImage.target.querySelector(".fce-card-image")).toBeNull();
  });

  it("applies the configured card corner radius class", () => {
    const { target } = mountCardItem({ cardCornerRadius: "rounded" });

    expect(target.querySelector(".fce-card")?.classList.contains("fce-card-radius-rounded")).toBe(true);
    expect(target.querySelector(".fce-card")?.classList.contains("fce-card-radius-compact")).toBe(false);
  });

  it("supports keyboard and context menu actions", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({}, captured.callbacks);

    expect(target.textContent).toContain("A note");
    expect(target.innerHTML).toContain("Preview text");
    expect(target.querySelector(".fce-meta")).toBeNull();
    expect(target.textContent).not.toContain("Modified");
    expect(target.textContent).not.toContain("Created");

    const cardButton = target.querySelector<HTMLDivElement>(".fce-card");
    expect(cardButton).not.toBeNull();

    cardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    cardButton?.dispatchEvent(keyboardEvent);

    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    cardButton?.dispatchEvent(contextEvent);

    expect(keyboardEvent.defaultPrevented).toBe(true);
    expect(contextEvent.defaultPrevented).toBe(true);
    expect(captured.openEvents).toEqual([
      { path: "notes/a.md" },
      { path: "notes/a.md" },
    ]);
    expect(captured.contextEvents).toHaveLength(1);
    expect(captured.contextEvents[0]).toEqual({
      path: "notes/a.md",
      mouseEvent: contextEvent,
    });
  });

  it("emits plugin-private drag data and drag visual state", () => {
    const { target } = mountCardItem();
    const cardButton = target.querySelector<HTMLDivElement>(".fce-card");
    expect(cardButton?.getAttribute("draggable")).toBe("true");

    const dragData = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn((type: string, value: string) => {
        dragData.set(type, value);
      }),
      setDragImage: vi.fn(),
    };
    const dragStartEvent = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(dragStartEvent, "dataTransfer", {
      value: dataTransfer,
    });

    cardButton?.dispatchEvent(dragStartEvent);

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-card-workspace-note",
      JSON.stringify({ path: "notes/a.md", title: "A note" }),
    );
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
    const nativeDragImage = dataTransfer.setDragImage.mock.calls[0]?.[0] as HTMLElement | undefined;
    expect(nativeDragImage?.className).toBe("fce-card-native-drag-image");
    expect(dataTransfer.setDragImage.mock.calls[0]?.slice(1)).toEqual([0, 0]);
    const dragGhost = document.body.querySelector<HTMLElement>(".fce-card-drag-ghost");
    expect(dragGhost?.querySelector(".fce-card-drag-ghost-title")?.textContent).toBe("A note");
    const dragEvent = new MouseEvent("drag", { bubbles: true, clientX: 40, clientY: 50 }) as DragEvent;
    cardButton?.dispatchEvent(dragEvent);
    expect(dragGhost?.style.left).toBe("52px");
    expect(dragGhost?.style.top).toBe("62px");
    expect(dragGhost?.querySelector(".fce-card-drag-ghost-action")?.textContent).toBe("Insert here");
    expect(cardButton?.classList.contains("is-dragging")).toBe(true);

    const dragEndEvent = new Event("dragend", { bubbles: true }) as DragEvent;
    cardButton?.dispatchEvent(dragEndEvent);

    expect(cardButton?.classList.contains("is-dragging")).toBe(false);
    expect(document.body.querySelector(".fce-card-drag-ghost")).toBeNull();
  });

  it("renders the full long title in the floating drag ghost", () => {
    const longTitle = "一级按钮右键功能分组菜单需要保持清晰可见直到末尾仍然不变淡";
    const { target } = mountCardItem({
      card: createCard("notes/long.md", { title: longTitle }),
      strings: {
        ...getUiStrings("zh").cardItem,
      },
    });
    const cardButton = target.querySelector<HTMLDivElement>(".fce-card");
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    const dragStartEvent = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(dragStartEvent, "dataTransfer", {
      value: dataTransfer,
    });

    cardButton?.dispatchEvent(dragStartEvent);

    const dragGhost = document.body.querySelector<HTMLElement>(".fce-card-drag-ghost");
    expect(dragGhost?.querySelector(".fce-card-drag-ghost-title")?.textContent).toBe(longTitle);
    expect(dragGhost?.querySelector(".fce-card-drag-ghost-action")?.textContent).toBe("在此处插入");
  });


  it("emits bulk-select-card with shiftKey in bulk mode from the card surface", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ bulkMode: true }, captured.callbacks);

    const clickEvent = new MouseEvent("click", { bubbles: true, shiftKey: true });
    const cardButton = target.querySelector<HTMLDivElement>(".fce-card");
    cardButton?.dispatchEvent(clickEvent);

    expect(captured.bulkEvents).toEqual([{ path: "notes/a.md", shiftKey: true }]);
  });

  it("emits contextmenu with trigger='button' when more-actions button is clicked", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({}, captured.callbacks);

    const moreActionsBtn = target.querySelector<HTMLButtonElement>(".fce-more-actions-btn");
    expect(moreActionsBtn).not.toBeNull();
    
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      bottom: 100,
      height: 20,
      left: 50,
      right: 70,
      top: 80,
      width: 20,
      x: 50,
      y: 80,
      toJSON: () => {}
    });

    const clickEvent = new MouseEvent("click", { bubbles: true });
    moreActionsBtn?.dispatchEvent(clickEvent);

    expect(captured.contextEvents).toEqual([
      {
        path: "notes/a.md",
        trigger: "button",
        position: { x: 50, y: 100 },
      },
    ]);
    expect(captured.openEvents).toHaveLength(0);

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    moreActionsBtn?.dispatchEvent(keyboardEvent);

    expect(captured.contextEvents).toHaveLength(2);
    expect(captured.contextEvents[1]).toEqual({
      path: "notes/a.md",
      trigger: "button",
      position: { x: 50, y: 100 },
    });
    expect(captured.openEvents).toHaveLength(0);

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("keeps the file-type icon visible in bulk mode while showing the checkbox", () => {
    const { target } = mountCardItem({
      bulkMode: true,
      bulkSelected: true,
      pinnedPaths: ["notes/a.md"],
      card: createCard("notes/model.base", {
        fileKind: "base",
        title: "model.base",
        previewMode: "placeholder",
        previewHtml: "",
      }),
    });

    const checkbox = target.querySelector<HTMLInputElement>(".fce-card-bulk-checkbox");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
    expect(target.querySelector(".fce-card-pin-btn")).toBeNull();
    expect(target.querySelector(".fce-card-file-icon[data-file-kind='base']")).not.toBeNull();
    expect(target.querySelector(".fce-card-actions")?.lastElementChild).toBe(checkbox);
  });

  it("emits exactly one bulk-select event when the bulk checkbox is clicked", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ bulkMode: true }, captured.callbacks);

    const checkbox = target.querySelector<HTMLInputElement>(".fce-card-bulk-checkbox");
    expect(checkbox).not.toBeNull();

    checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));

    expect(captured.bulkEvents).toEqual([{ path: "notes/a.md", shiftKey: true }]);
    expect(captured.openEvents).toEqual([]);
  });

  it("emits exactly one bulk-select event when the bulk checkbox is activated by keyboard", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ bulkMode: true }, captured.callbacks);

    const checkbox = target.querySelector<HTMLInputElement>(".fce-card-bulk-checkbox");
    expect(checkbox).not.toBeNull();

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    checkbox?.dispatchEvent(keyboardEvent);

    expect(keyboardEvent.defaultPrevented).toBe(true);
    expect(captured.bulkEvents).toEqual([{ path: "notes/a.md", shiftKey: false }]);
    expect(captured.openEvents).toEqual([]);
  });

  it("renders mapped file-type icons and keeps pin behavior in normal mode", async () => {
    const captured = createCapturedCallbacks();
    const { component, target } = mountCardItem(
      {
        card: createCard("notes/model.base", {
          fileKind: "base",
          title: "model.base",
          previewMode: "placeholder",
          previewHtml: "",
        }),
      },
      captured.callbacks,
    );

    await tick();

    const icon = target.querySelector<HTMLElement>(".fce-card-file-icon[data-file-kind='base']");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).toBe("layout-list");

    const pinButton = target.querySelector<HTMLButtonElement>(".fce-card-pin-btn");
    expect(pinButton).not.toBeNull();
    expect(target.querySelector(".fce-card-bulk-checkbox")).toBeNull();

    pinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.pinEvents[0]).toEqual({ path: "notes/model.base", pinned: true });

    await disposeMountedComponent(component);

    const { component: canvasComponent, target: canvasTarget } = mountCardItem(
      {
        card: createCard("notes/diagram.canvas", {
          fileKind: "canvas",
          title: "diagram.canvas",
          previewMode: "placeholder",
          previewHtml: "",
        }),
      },
    );

    await tick();

    const canvasIcon = canvasTarget.querySelector<HTMLElement>(".fce-card-file-icon[data-file-kind='canvas']");
    expect(canvasIcon).not.toBeNull();
    expect(canvasIcon?.getAttribute("data-icon")).toBe("layout-dashboard");

    await disposeMountedComponent(canvasComponent);

    const { target: remountedTarget } = mountCardItem(
      {
        card: createCard("notes/model.base", {
          fileKind: "base",
          title: "model.base",
          previewMode: "placeholder",
          previewHtml: "",
        }),
        pinnedPaths: ["notes/model.base"],
      },
      captured.callbacks,
    );
    const remountedPinButton = remountedTarget.querySelector<HTMLButtonElement>(".fce-card-pin-btn");
    expect(remountedPinButton).not.toBeNull();

    remountedPinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.pinEvents[1]).toEqual({ path: "notes/model.base", pinned: false });
  });

  it("highlights the title and structured body snippets from the current query", async () => {
    const { target } = mountCardItem({ searchQuery: "note preview", card: await searchCard("note preview", "Preview text") });
    expect(target.querySelector("h4")?.innerHTML).toContain('<mark class="fce-search-hit">note</mark>');
    expect(getExcerptHtml(target)).toContain('<mark class="fce-search-hit">Preview</mark>');
    expect(target.querySelector(".fce-search-snippet")?.textContent).toContain("Preview text");
  });

  it("renders ordinary read-only task, heading, code and link cues in search snippets", async () => {
    const source = "# needle heading\n\n2) [x] needle task\n\nneedle `code_text` [[Target|alias]]";
    const card = await searchCard("needle", source, {}, 5, 3);
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ searchQuery: "needle", card,
      appearance: { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 3 } }, captured.callbacks);
    expect(Array.from(target.querySelectorAll(".fce-preview-heading"), node => node.textContent).join("")).toContain("needle heading");
    expect(target.querySelector(".fce-preview-list-marker")?.textContent).toBe("2)");
    expect(target.querySelector(".fce-preview-task-done")).not.toBeNull();
    expect(target.querySelector(".fce-search-snippet code")?.textContent).toBe("code_text");
    expect(target.querySelector(".fce-preview-link")?.textContent).toBe("alias");
    expect(target.querySelector(".fce-search-snippet a, .fce-search-snippet input")).toBeNull();
    (target.querySelector(".fce-preview-link") as HTMLElement).click();
    expect(captured.openEvents).toHaveLength(1);
    expect(captured.openEvents[0].snippetId).toBe(card.searchPreview?.snippets[2].id);
  });

  it("merges overlapping Chinese hits and preserves supplementary Han characters", async () => {
    const { target } = mountCardItem({ searchQuery: "中文搜索", card: await searchCard("中文搜索", "预览中文搜索内容", { title: "开始中文搜索结束" }) });
    expect(target.querySelector("h4")?.innerHTML).toContain('<mark class="fce-search-hit">中文搜索</mark>');
    expect(getExcerptHtml(target)).toContain('<mark class="fce-search-hit">中文搜索</mark>');
    const supplementary = mountCardItem({ searchQuery: "𠀀", card: await searchCard("𠀀", "预览𠀀内容", { title: "甲𠀀乙" }) });
    expect(getExcerptHtml(supplementary.target)).toContain('<mark class="fce-search-hit">𠀀</mark>');
  });

  it("highlights mixed query terms in source order", async () => {
    const { target } = mountCardItem({ searchQuery: "OpenAI中文-search", card: await searchCard("OpenAI中文-search", "search 中文 OpenAI", { title: "OpenAI 中文 search" }) });
    expect(Array.from(target.querySelectorAll("h4 mark"), (mark) => mark.textContent)).toEqual(["OpenAI", "中文", "search"]);
    expect(Array.from(target.querySelectorAll(".fce-excerpt mark"), (mark) => mark.textContent)).toEqual(["search", "中文", "OpenAI"]);
  });

  it("keeps title metacharacters literal while snippets follow index token boundaries", async () => {
    const { target } = mountCardItem({ searchQuery: "[draft] a+b", card: await searchCard("[draft] a+b", "[draft] and a+b, not aaab", { title: "Plan [draft] a+b" }) });
    expect(Array.from(target.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(["[draft]", "a+b", "draft", "a+b"]);
  });

  it.each([1, 2, 3, 4, 5])("renders %i two-line snippets independently of ordinary preview lines", async (snippetLimit) => {
    const card = await searchCard("needle", Array.from({ length: 10 }, (_, i) => `line ${i} needle`).join("\n\n"), {}, 0, snippetLimit);
    const { target } = mountCardItem({ searchQuery: "needle", card, appearance: { cardCornerRadius: "compact", previewLines: 0, searchPreviewSnippetCount: snippetLimit } });
    expect(target.querySelectorAll(".fce-search-snippet")).toHaveLength(snippetLimit);
    expect(target.querySelector(".fce-excerpt")?.getAttribute("style")).toContain(`--fce-preview-line-clamp: ${snippetLimit * 2}`);
  });

  it("opens each snippet once by mouse, Enter, and Space; the title opens normally", async () => {
    const captured = createCapturedCallbacks();
    const card = await searchCard("needle", "first needle\n\nsecond needle");
    const { target } = mountCardItem({ searchQuery: "needle", card }, captured.callbacks);
    const buttons = target.querySelectorAll(".fce-search-snippet");
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    target.querySelector("h4")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.openEvents).toEqual([
      { path: card.path, snippetId: card.searchPreview!.snippets[0].id },
      { path: card.path, snippetId: card.searchPreview!.snippets[1].id },
      { path: card.path, snippetId: card.searchPreview!.snippets[1].id },
      { path: card.path },
    ]);
  });

  it("uses card selection for snippet activation in bulk mode", async () => {
    const captured = createCapturedCallbacks();
    const card = await searchCard("needle", "needle");
    const { target } = mountCardItem({ searchQuery: "needle", card, bulkMode: true }, captured.callbacks);
    const button = target.querySelector(".fce-search-snippet")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(captured.openEvents).toEqual([]);
    expect(captured.bulkEvents).toEqual([{ path: card.path, shiftKey: true }, { path: card.path, shiftKey: false }]);
  });

  it("escapes snippet text structurally without parsing HTML", async () => {
    const sanitizer = vi.fn(sanitizePreviewHtml);
    const card = await searchCard("needle", '<script>needle</script> <img onerror="bad()">');
    const { target } = mountCardItem({ searchQuery: "needle", card, previewHtmlSanitizer: sanitizer });
    expect(target.querySelector(".fce-excerpt")?.textContent).toContain("<script needle</script");
    expect(target.querySelector(".fce-excerpt script, .fce-excerpt img")).toBeNull();
    expect(sanitizer).not.toHaveBeenCalled();
  });

  it("hides previews belonging to an old query or preview preference", async () => {
    const card = await searchCard("needle", "needle");
    for (const props of [
      { searchQuery: "needle", appearance: { previewLines: 5, searchPreviewSnippetCount: 5, cardCornerRadius: "compact" } },
      { searchQuery: "other" },
      { searchQuery: "needle", appearance: { previewLines: 8, searchPreviewSnippetCount: 2, cardCornerRadius: "compact" } },
    ]) {
      const { target } = mountCardItem({ card, ...props });
      expect(target.querySelectorAll(".fce-search-snippet")).toHaveLength(0);
      expect(target.querySelector(".fce-excerpt")?.textContent).toContain("Loading preview");
    }
    const cleared = mountCardItem({ card, searchQuery: "" });
    expect(getExcerptHtml(cleared.target)).toContain("<p>Preview text</p>");
  });

  it.each(["en", "zh"] as const)("renders title-only and unavailable status in %s", async (language) => {
    const card = await searchCard("needle", "no body hit");
    for (const status of ["title-only", "unavailable"] as const) {
      card.searchPreview = { ...card.searchPreview!, status };
      const strings = getUiStrings(language);
      const { target } = mountCardItem({ card, searchQuery: "needle", strings: strings.cardItem });
      expect(target.querySelector(".fce-excerpt")?.textContent).toContain(status === "title-only" ? "Preview text" : strings.cardItem.searchBodyUnavailable);
    }
  });

  it("does not add highlighting when the query is empty", () => {
    const { target } = mountCardItem({
      searchQuery: "   ",
      card: createCard("notes/no-query.md"),
    });

    expect(target.querySelectorAll("mark.fce-search-hit")).toHaveLength(0);
    expect(target.querySelector("h4")?.textContent).toBe("A note");
    expect(getExcerptHtml(target)).toContain("<p>Preview text</p>");
  });

  it("renders literal title text instead of injecting title HTML", () => {
    const { target } = mountCardItem({
      card: createCard("notes/title-html.md", {
        title: "<b>Unsafe</b> note",
      }),
    });

    const title = target.querySelector("h4");

    expect(title?.textContent).toBe("<b>Unsafe</b> note");
    expect(title?.innerHTML).toContain("&lt;b&gt;Unsafe&lt;/b&gt; note");
    expect(title?.querySelector("b")).toBeNull();
  });

  it("shows loading while the committed search preview is being hydrated", () => {
    const { target } = mountCardItem({
      searchQuery: "missing token",
      card: createCard("notes/non-match.md"),
    });

    expect(target.querySelectorAll("mark.fce-search-hit")).toHaveLength(0);
    expect(target.querySelector("h4")?.textContent).toBe("A note");
    expect(getExcerptHtml(target)).toContain("Loading preview...");
  });

  it("sanitizes the ordinary preview HTML", () => {
    const { target } = mountCardItem({
      card: createCard("notes/sanitized-preview.md", {
        previewHtml: '<p class="fce-preview-heading" onclick="alert(1)">Safe <strong>bold</strong><script>window.__cardItemInjected = true;</script></p>',
      }),
    });

    const excerpt = target.querySelector<HTMLElement>(".fce-excerpt");
    expect(excerpt).not.toBeNull();
    expect(excerpt?.querySelector("script")).toBeNull();

    const paragraph = excerpt?.querySelector("p");
    expect(paragraph?.className).toBe("fce-preview-heading");
    expect(paragraph?.getAttribute("onclick")).toBeNull();
    expect(paragraph?.querySelector("strong")).toBeNull();
    expect(excerpt?.textContent).toContain("Safe bold");

  });

  it("keeps ordinary styled link hover and click targeting the card", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({
      card: createCard("notes/current.md", {
        previewHtml: '<p>See <span class="fce-preview-link">Alias</span></p>',
      }),
    }, captured.callbacks);
    const link = target.querySelector<HTMLElement>(".fce-preview-link");

    expect(link?.innerHTML).toBe("Alias");
    expect(link?.getAttribute("href")).toBeNull();
    link?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.hoverEvents.map((event) => event.path)).toEqual(["notes/current.md"]);
    expect(captured.openEvents).toEqual([{ path: "notes/current.md" }]);
  });

  it("allows only the preview link class on spans and strips link attributes", () => {
    const sanitized = sanitizePreviewHtml(
      '<p><span class="fce-preview-link unwanted" href="javascript:alert(1)" onclick="alert(1)" style="color:red">Safe</span><a href="https://example.com">plain</a></p>',
      document,
    );

    expect(sanitized).toBe('<p><span class="fce-preview-link">Safe</span>plain</p>');
    expect(highlightSanitizedPreviewHtml(sanitized, "safe", document))
      .toContain('<span class="fce-preview-link"><mark class="fce-search-hit">Safe</mark></span>');
  });

  it("keeps a read-only task marker in the ordinary preview", () => {
    const previewHtml = buildLightPreview("- [x] targeted task").html;
    const { target } = mountCardItem({
      card: createCard("notes/task.md", { previewHtml }),
    });
    const excerpt = target.querySelector<HTMLElement>(".fce-excerpt");

    expect(excerpt?.querySelector(".fce-preview-task-done")).not.toBeNull();
    expect(excerpt?.querySelector(".fce-preview-list-marker")).toBeNull();
    expect(excerpt?.querySelector(".fce-preview-list-content")?.innerHTML)
      .toBe('targeted task');
    expect(excerpt?.querySelector("input, button, [role='checkbox'], [contenteditable]")).toBeNull();
  });

  it("allows only list presentation classes and drops interactive markup", () => {
    const sanitized = sanitizePreviewHtml(
      '<p class="fce-preview-list-item unwanted" onclick="alert(1)"><span class="fce-preview-list-marker unwanted" tabindex="0">☐</span><span class="fce-preview-list-content unwanted" contenteditable="true">Safe</span><input type="checkbox" checked></p>',
      document,
    );

    expect(sanitized).toBe('<p class="fce-preview-list-item"><span class="fce-preview-list-marker">☐</span><span class="fce-preview-list-content">Safe</span></p>');

    const taskBox = sanitizePreviewHtml(
      '<p class="fce-preview-list-item"><span class="fce-preview-task fce-preview-task-done unwanted" onclick="alert(1)"></span><span class="fce-preview-task"><span class="fce-preview-task-glyph unwanted" style="color:red">&gt;</span></span></p>',
      document,
    );
    expect(taskBox).toBe('<p class="fce-preview-list-item"><span class="fce-preview-task fce-preview-task-done"></span><span class="fce-preview-task"><span class="fce-preview-task-glyph">&gt;</span></span></p>');
    expect(highlightSanitizedPreviewHtml(sanitized, "safe", document))
      .toContain('<span class="fce-preview-list-content"><mark class="fce-search-hit">Safe</mark></span>');
  });

  it.each([""])("uses the sanitizer allow-list for query %j", (searchQuery) => {
    const { target } = mountCardItem({
      searchQuery,
      card: createCard("notes/hostile-preview.md", {
        previewHtml: '<section class="unapproved"><p class="fce-preview-heading unapproved" onmouseover="alert(1)">Safe <strong data-bad="1">bold</strong><script>alert(2)</script><code onclick="alert(3)">code</code></p></section>',
      }),
    });
    const excerpt = target.querySelector<HTMLElement>(".fce-excerpt");

    expect(excerpt?.querySelector("script, section, strong")).toBeNull();
    expect(excerpt?.querySelector("[onmouseover], [onclick], [data-bad]")).toBeNull();
    expect(excerpt?.querySelector(".unapproved")).toBeNull();
    expect(excerpt?.querySelector("p")?.className).toBe("fce-preview-heading");
    expect(excerpt?.textContent).toContain("Safe boldalert(2)code");
  });

  it("sanitizes the ordinary base once", () => {
    const sanitizer = vi.fn(sanitizePreviewHtml);
    const { target } = mountCardItem({
      card: createCard("notes/query-update.md", { previewHtml: "<p>alpha beta</p>" }),
      previewHtmlSanitizer: sanitizer,
    });

    expect(sanitizer).toHaveBeenCalledTimes(1);
    expect(getExcerptHtml(target)).toContain("<p>alpha beta</p>");

    const sanitizedBase = sanitizer.mock.results[0]?.value ?? "";
    const betaHtml = highlightSanitizedPreviewHtml(sanitizedBase, "beta", document);

    expect(sanitizer).toHaveBeenCalledTimes(1);
    expect(betaHtml).not.toContain('<mark class="fce-search-hit">alpha</mark>');
    expect(betaHtml).toContain('<mark class="fce-search-hit">beta</mark>');
  });

  it("returns sanitized base HTML for an empty query before highlighting", () => {
    const hostile = '<p class="fce-preview-heading bad" onclick="alert(1)">Safe <em>text</em><script>bad()</script></p>';
    const sanitized = sanitizePreviewHtml(hostile, document);

    expect(highlightSanitizedPreviewHtml(sanitized, "", document)).toBe(sanitized);
    expect(sanitized).toBe('<p class="fce-preview-heading">Safe textbad()</p>');
  });

  it("escapes parsed text when serializing sanitized preview HTML", () => {
    const sanitized = sanitizePreviewHtml(
      "<p>Fish &amp; chips &lt;img src=x onerror=alert(1)&gt;</p>",
      document,
    );

    expect(sanitized).toBe("<p>Fish &amp; chips &lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("keeps the sanitized base when highlighting throws", () => {
    const sanitized = sanitizePreviewHtml('<p onclick="alert(1)">Safe text</p><script>bad()</script>', document);
    const treeWalker = vi.spyOn(document, "createTreeWalker").mockImplementationOnce(() => {
      throw new Error("highlight failure");
    });

    expect(highlightSanitizedPreviewHtml(sanitized, "safe", document)).toBe(sanitized);
    expect(sanitized).toBe("<p>Safe text</p>bad()");
    treeWalker.mockRestore();
  });

  it("non-markdown cards remain title-searchable only", () => {
    const { target } = mountCardItem({
      searchQuery: "canvas",
      card: createCard("notes/workflow.canvas", {
        fileKind: "canvas",
        title: "workflow.canvas",
        previewMode: "placeholder",
        previewHtml: "<p class=\"fce-preview-placeholder\">This is a canvas file.</p>",
        excerpt: "",
      }),
    });

    expect(target.querySelector("h4")?.innerHTML).toContain('<mark class="fce-search-hit">canvas</mark>');
    expect(target.querySelector(".fce-excerpt")?.querySelectorAll("mark.fce-search-hit")).toHaveLength(0);
  });

  it("renders exact placeholder copy for non-markdown cards", () => {
    const cards: NoteCardRecord[] = [
      createCard("notes/model.base", {
        fileKind: "base",
        title: "model.base",
        previewMode: "placeholder",
        previewHtml: "",
      }),
      createCard("notes/diagram.canvas", {
        fileKind: "canvas",
        title: "diagram.canvas",
        previewMode: "placeholder",
        previewHtml: "",
      }),
      createCard("notes/sketch.excalidraw", {
        fileKind: "excalidraw",
        title: "sketch.excalidraw",
        previewMode: "placeholder",
        previewHtml: "",
      }),
    ];

    const first = mountCardItem({ card: cards[0] });
    const second = mountCardItem({ card: cards[1] });
    const third = mountCardItem({ card: cards[2] });

    expect(first.target.textContent).toContain("This is a base file.");
    expect(second.target.textContent).toContain("This is a canvas file.");
    expect(third.target.textContent).toContain("This is an excalidraw file.");
  });

  it("renders file-kind icon metadata in the card title group", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/model.base", {
        fileKind: "base",
      }),
    });

    await tick();

    const icon = target.querySelector<HTMLElement>(".fce-card-file-icon[data-file-kind='base']");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).toBe("layout-list");
  });

  it("emits hover-link payload from title and excerpt surfaces for markdown cards", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({}, captured.callbacks);

    const titleGroup = target.querySelector<HTMLElement>(".fce-card-title-group");
    const excerpt = target.querySelector<HTMLElement>(".fce-excerpt");
    expect(titleGroup).not.toBeNull();
    expect(excerpt).not.toBeNull();
    expect(target.querySelector(".fce-meta")).toBeNull();

    const titleEvent = new MouseEvent("mouseenter", { bubbles: true });
    const excerptEvent = new MouseEvent("mouseenter", { bubbles: true });
    titleGroup?.dispatchEvent(titleEvent);
    excerpt?.dispatchEvent(excerptEvent);

    expect(captured.hoverEvents).toEqual([
      {
        path: "notes/a.md",
        targetEl: titleGroup,
        mouseEvent: titleEvent,
      },
      {
        path: "notes/a.md",
        targetEl: excerpt,
        mouseEvent: excerptEvent,
      },
    ]);
  });

  it("emits hover-link payload from the same narrow surfaces for supported non-markdown cards", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem(
      {
        card: createCard("notes/model.base", {
          fileKind: "base",
          title: "model.base",
          previewMode: "placeholder",
          previewHtml: "",
        }),
      },
      captured.callbacks,
    );

    const titleGroup = target.querySelector<HTMLElement>(".fce-card-title-group");
    const excerpt = target.querySelector<HTMLElement>(".fce-excerpt");
    expect(titleGroup).not.toBeNull();
    expect(excerpt).not.toBeNull();
    expect(target.querySelector(".fce-meta")).toBeNull();

    titleGroup?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    excerpt?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(captured.hoverEvents).toHaveLength(2);
    expect(captured.hoverEvents.map((event) => event.path)).toEqual([
      "notes/model.base",
      "notes/model.base",
    ]);
    expect(captured.hoverEvents.map((event) => event.targetEl)).toEqual([titleGroup, excerpt]);
  });

  it("does not emit hover-link payload from action buttons or bulk checkbox", () => {
    const normalCaptured = createCapturedCallbacks();
    const normalMount = mountCardItem({}, normalCaptured.callbacks);

    const pinButton = normalMount.target.querySelector<HTMLButtonElement>(".fce-card-pin-btn");
    const moreActionsButton = normalMount.target.querySelector<HTMLButtonElement>(".fce-more-actions-btn");
    expect(pinButton).not.toBeNull();
    expect(moreActionsButton).not.toBeNull();

    pinButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    moreActionsButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(normalCaptured.hoverEvents).toEqual([]);

    const bulkCaptured = createCapturedCallbacks();
    const bulkMount = mountCardItem({ bulkMode: true }, bulkCaptured.callbacks);
    const bulkCheckbox = bulkMount.target.querySelector<HTMLInputElement>(".fce-card-bulk-checkbox");
    expect(bulkCheckbox).not.toBeNull();

    bulkCheckbox?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(bulkCaptured.hoverEvents).toEqual([]);
  });

  it("does not render a task footer when taskSummary is null", () => {
    const { target } = mountCardItem();

    expect(target.querySelector(".fce-card-task-footer")).toBeNull();
    expect(target.querySelector(".fce-meta")).toBeNull();
    expect(target.textContent).not.toContain("Modified");
    expect(target.textContent).not.toContain("Created");
  });

  it("renders an untouched-task footer with an empty circle and a zero completed count", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/tasks.md", { taskSummary: { total: 5, incomplete: 5 } }),
    });

    await tick();

    const footer = target.querySelector<HTMLElement>(".fce-card-task-footer");
    const icon = footer?.querySelector<HTMLElement>(".fce-card-task-icon");
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("is-complete")).toBe(false);
    expect(icon?.getAttribute("data-icon")).toBe("circle");
    expect(footer?.querySelector(".fce-card-task-count")?.textContent).toBe("0/5");
  });

  it("renders a partially complete footer with a dotted circle", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/tasks.md", { taskSummary: { total: 10, incomplete: 8 } }),
    });

    await tick();

    const footer = target.querySelector<HTMLElement>(".fce-card-task-footer");
    const icon = footer?.querySelector<HTMLElement>(".fce-card-task-icon");
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("is-complete")).toBe(false);
    expect(icon?.getAttribute("data-icon")).toBe("circle-dot");
    expect(footer?.querySelector(".fce-card-task-count")?.textContent).toBe("2/10");
  });

  it("renders a complete-task footer with a checked circle and a saturated count", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/done.md", { taskSummary: { total: 5, incomplete: 0 } }),
    });

    await tick();

    const footer = target.querySelector<HTMLElement>(".fce-card-task-footer");
    const icon = footer?.querySelector<HTMLElement>(".fce-card-task-icon");
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("is-complete")).toBe(true);
    expect(icon?.getAttribute("data-icon")).toBe("circle-check");
    expect(footer?.querySelector(".fce-card-task-count")?.textContent).toBe("5/5");
  });

  it("does not render a task footer for a canvas card with a null summary", () => {
    const { target } = mountCardItem({
      card: createCard("notes/diagram.canvas", {
        fileKind: "canvas",
        title: "diagram.canvas",
        previewMode: "placeholder",
        previewHtml: "",
        taskSummary: null,
      }),
    });

    expect(target.querySelector(".fce-card-task-footer")).toBeNull();
  });

  it("places the task footer as the last child of the card body after the excerpt", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/tasks.md", { taskSummary: { total: 5, incomplete: 3 } }),
    });

    await tick();

    const body = target.querySelector(".fce-card-body");
    const excerpt = target.querySelector(".fce-excerpt");
    const footer = target.querySelector(".fce-card-task-footer");
    expect(body?.lastElementChild).toBe(footer);
    expect(excerpt?.nextElementSibling).toBe(footer);
  });

  it("exposes the task footer as a non-interactive image with a descriptive label", async () => {
    const { target } = mountCardItem({
      card: createCard("notes/tasks.md", { taskSummary: { total: 5, incomplete: 3 } }),
    });

    await tick();

    const footer = target.querySelector<HTMLElement>(".fce-card-task-footer");
    expect(footer?.getAttribute("role")).toBe("img");
    expect(footer?.getAttribute("aria-label")).toBe("2 of 5 tasks complete");
    expect(footer?.hasAttribute("tabindex")).toBe(false);
    expect(footer?.classList.contains("clickable-icon")).toBe(false);
    expect(footer?.querySelector("[role='button'], [tabindex], .clickable-icon")).toBeNull();
  });

  it("uses Chinese task-footer aria-label strings", async () => {
    const incomplete = mountCardItem({
      card: createCard("notes/tasks.md", { taskSummary: { total: 5, incomplete: 3 } }),
      strings: {
        ...getUiStrings("zh").cardItem,
      },
    });
    const complete = mountCardItem({
      card: createCard("notes/done.md", { taskSummary: { total: 5, incomplete: 0 } }),
      strings: {
        ...getUiStrings("zh").cardItem,
      },
    });

    await tick();

    expect(incomplete.target.querySelector(".fce-card-task-footer")?.getAttribute("aria-label")).toBe(
      "5 个任务中已完成 2 个",
    );
    expect(complete.target.querySelector(".fce-card-task-footer")?.getAttribute("aria-label")).toBe(
      "5 个任务中已完成 5 个",
    );
  });
});
