import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, unmount } from "svelte";
import CardItem from "./CardItem.svelte";
import type { NoteCardRecord } from "./types";

interface OpenNotePayload {
  path: string;
}

interface PinTogglePayload {
  path: string;
  pinned: boolean;
}

interface CardContextMenuPayload {
  path: string;
  mouseEvent: MouseEvent;
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
}

interface CapturedCallbacks {
  callbacks: CardItemCallbacks;
  openEvents: OpenNotePayload[];
  pinEvents: PinTogglePayload[];
  contextEvents: CardContextMenuPayload[];
  bulkEvents: BulkSelectCardPayload[];
}

interface MountedCardItem {
  component: Record<string, unknown>;
  target: HTMLDivElement;
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createCard(path: string = "notes/a.md"): NoteCardRecord {
  return {
    file: {} as never,
    path,
    title: "A note",
    ctime: new Date("2024-01-02T10:00:00Z").getTime(),
    mtime: new Date("2024-02-03T12:00:00Z").getTime(),
    excerpt: "excerpt",
    previewHtml: "<p>Preview text</p>",
    previewMode: "text",
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
    },
    openEvents,
    pinEvents,
    contextEvents,
    bulkEvents,
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

  it("supports keyboard and context menu actions", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({}, captured.callbacks);

    expect(target.textContent).toContain("A note");
    expect(target.innerHTML).toContain("Preview text");

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
    expect(captured.openEvents).toEqual([{ path: "notes/a.md" }, { path: "notes/a.md" }]);
    expect(captured.contextEvents).toHaveLength(1);
    expect(captured.contextEvents[0]).toEqual({
      path: "notes/a.md",
      mouseEvent: contextEvent,
    });
  });

  it("emits bulk-select-card with shiftKey in bulk mode", () => {
    const captured = createCapturedCallbacks();
    const { target } = mountCardItem({ bulkMode: true }, captured.callbacks);

    const clickEvent = new MouseEvent("click", { bubbles: true, shiftKey: true });
    const cardButton = target.querySelector<HTMLDivElement>(".fce-card");
    cardButton?.dispatchEvent(clickEvent);

    expect(captured.bulkEvents).toEqual([{ path: "notes/a.md", shiftKey: true }]);
  });

  it("emits pin-toggle with correct toggled pinned value", async () => {
    const captured = createCapturedCallbacks();
    const { component, target } = mountCardItem({}, captured.callbacks);

    const pinButton = target.querySelector<HTMLButtonElement>(".fce-card-pin-btn");
    expect(pinButton).not.toBeNull();

    pinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.pinEvents[0]).toEqual({ path: "notes/a.md", pinned: true });

    await disposeMountedComponent(component);

    const { target: remountedTarget } = mountCardItem(
      { pinnedPaths: ["notes/a.md"] },
      captured.callbacks,
    );
    const remountedPinButton = remountedTarget.querySelector<HTMLButtonElement>(".fce-card-pin-btn");
    expect(remountedPinButton).not.toBeNull();

    remountedPinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.pinEvents[1]).toEqual({ path: "notes/a.md", pinned: false });
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

  it("leaves non-matching content unchanged", () => {
    const { target } = mountCardItem({
      searchQuery: "missing token",
      card: createCard("notes/non-match.md"),
    });

    expect(target.querySelectorAll("mark.fce-search-hit")).toHaveLength(0);
    expect(target.querySelector("h4")?.innerHTML).toBe("A note");
    expect(getExcerptHtml(target)).toContain("<p>Preview text</p>");
  });
});
