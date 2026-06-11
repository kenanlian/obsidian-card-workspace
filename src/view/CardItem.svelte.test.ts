import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, tick } from "svelte";
import CardItem from "./CardItem.svelte";
import { getUiStrings } from "../i18n";
import type { CardFileKind } from "./file-kind";
import type { CardHoverLinkPayload, NoteCardRecord } from "./types";

interface OpenNotePayload {
  path: string;
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
}

function createCard(path: string = "notes/a.md", options: CreateCardOptions = {}): NoteCardRecord {
  const {
    fileKind = "markdown",
    title = "A note",
    previewHtml = "<p>Preview text</p>",
    previewMode = "text",
    excerpt = "excerpt",
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
  };
}

function getExcerptHtml(target: HTMLDivElement): string {
  return target.querySelector<HTMLElement>(".fce-excerpt")?.innerHTML ?? "";
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
  const component = mount(CardItem, {
    target,
    props: {
      card: createCard(),
      selected: false,
      bulkMode: false,
      bulkSelected: false,
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      ...callbacks,
      ...props,
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
    mountedComponents = [];
    document.body.innerHTML = "";
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

  it("highlights title and excerpt matches from the current query", () => {
    const { target } = mountCardItem({
      searchQuery: "note preview",
      card: createCard("notes/highlight.md"),
    });

    const title = target.querySelector("h4");
    const excerpt = target.querySelector(".fce-excerpt");

    expect(title?.innerHTML).toContain('<mark class="fce-search-hit">note</mark>');
    expect(getExcerptHtml(target)).toContain('<mark class="fce-search-hit">Preview</mark>');
    expect(excerpt?.textContent).toContain("Preview text");
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

  it("leaves non-matching content unchanged", () => {
    const { target } = mountCardItem({
      searchQuery: "missing token",
      card: createCard("notes/non-match.md"),
    });

    expect(target.querySelectorAll("mark.fce-search-hit")).toHaveLength(0);
    expect(target.querySelector("h4")?.textContent).toBe("A note");
    expect(getExcerptHtml(target)).toContain("<p>Preview text</p>");
  });

  it("sanitizes preview HTML before rendering search highlights", () => {
    const { target } = mountCardItem({
      searchQuery: "safe bold",
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
    expect(getExcerptHtml(target)).toContain('<mark class="fce-search-hit">Safe</mark>');
    expect(getExcerptHtml(target)).toContain('<mark class="fce-search-hit">bold</mark>');
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
});
