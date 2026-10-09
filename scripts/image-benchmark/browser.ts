import { mount, tick, unmount } from "svelte";
import { TFile } from "obsidian";
import FolderCardPanel from "../../src/view/FolderCardPanel.svelte";
import { createPanelModel } from "../../src/view/panel-model";
import { createViewStateStore } from "../../src/view/view-state-store";
import { createViewEpochs } from "../../src/view/view-epochs";
import { createFolderScope } from "../../src/view/scope";
import { HydrationController } from "../../src/view/controllers/HydrationController";
import { CardImageController } from "../../src/view/controllers/CardImageController";
import { ThumbnailService } from "../../src/images/ThumbnailService";
import { ThumbnailStore } from "../../src/images/ThumbnailStore";
import { ThumbnailWorker } from "../../src/images/ThumbnailWorker";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { DEFAULT_GROUP_SPEC } from "../../src/card-grouping-settings";
import { getUiStrings } from "../../src/i18n";
import { runPipeline, stepsForScope } from "../../src/view/pipeline";
const baseline = BENCHMARK_BASELINE;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let component: ReturnType<typeof mount> | null = null;
let controller: CardImageController | null = null, hydration: HydrationController | null = null, service: ThumbnailService | null = null;
let records: any[] = [], store: ReturnType<typeof createViewStateStore>, model: ReturnType<typeof createPanelModel>;
let referenceReads = 0;
let textReads = 0, originalReads = 0, activeReads = 0, peakReads = 0, metadataReads = 0;
let actualVisiblePaths: string[] = [];
let epochs: ReturnType<typeof createViewEpochs>, settings: any;
let textStarted = 0, textReady = 0;
let sample = 0;
let query = "";
let benchmarkApp: any;
let sourceFiles = new Map<string, any>();
let blobBytes = 0, urlPeak = 0;
const heldUrls = new Set<string>();
let fixtureFiles = new Map<string, File>();
const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => { const url = createUrl(blob); heldUrls.add(url); blobBytes += blob.size; urlPeak = Math.max(urlPeak, heldUrls.size); return url; };
URL.revokeObjectURL = (url) => { heldUrls.delete(url); revokeUrl(url); };
const longTasks: number[] = [];
const imageTasks: Array<{ kind: string; duration: number }> = [];
new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(entry.duration); }).observe({ type: "longtask", buffered: true });
function cardsGroup() {
  return { records: [...store.getVisibleCards()], searchMatchCountsByPath: {}, selectedPath: null, loading: false,
    generation: epochs.load.value, sequenceRevision: store.getVisibleSequenceRevision(), hydrationRevision: store.getHydrationRevision(),
    groupSegments: [], groupRevision: 0, extentCount: records.length };
}
function publish(...groups: string[]) {
  const imageOnly = groups.length === 1 && groups[0] === "images", imageStart = performance.now();
  if (groups.includes("cards") && controller?.prepareGeneration() && !groups.includes("images")) groups.push("images");
  model.batch((draft: any) => {
    if (groups.includes("cards")) draft.cards = cardsGroup();
    if (groups.includes("images")) draft.images = controller!.getPanelState();
  });
  if (imageOnly) void tick().then(() => { imageTasks.push({ kind: "image-publication", duration: performance.now() - imageStart }); });
  if (groups.includes("cards")) {
    controller?.notifyTextReady();
  }
}
async function close() {
  controller?.dispose(); hydration?.dispose(); if (component) await unmount(component);
  controller = null; hydration = null; component = null;
  service?.dispose(); service = null;
  document.querySelector("#mount")!.innerHTML = "";
}
async function open(options: { mode: string; columns: number; scenario: string; namespace: string; keepService?: boolean }) {
  const oldService = options.keepService ? service : null;
  if (oldService) service = null;
  await close();
  settings = { ...DEFAULT_SETTINGS, cardImageMode: baseline ? "off" : options.mode, cardImageFit: "contain", includeSubfolders: true };
  store = createViewStateStore(createFolderScope("notes", true)); epochs = createViewEpochs(); sourceFiles = new Map();
  const mappings: Record<string, string> = { dense: "regular.png", mixed: "regular.png", "8k": "8k.png", long: "long.png", repeat: "regular.png", "pixel-boundary": "pixel-boundary.png", "pixel-over": "pixel-over.png", "byte-boundary": "byte-boundary.png", "byte-over": "byte-over.png" };
  const fixture = mappings[options.scenario];
  const stats = await fetch("/stats.json").then((response) => response.json());
  const markdown = await fixtureFiles.get("note.md")!.text();
  const app = {
    vault: { getAbstractFileByPath: (path: string) => sourceFiles.get(path) ?? null,
      cachedRead: async () => { textReads++; return markdown; } },
    metadataCache: {
      getFileCache: (file: any) => {
        metadataReads++;
        if (!fixture || (options.scenario === "mixed" && Number(file.basename) % 2)) return {};
        const link = options.scenario === "repeat" ? fixture : `${file.basename}-${fixture}`;
        return { embeds: [{ original: `![[${link}]]`, link, position: { start: { offset: 500 } } }] };
      },
      getFirstLinkpathDest: (path: string) => { referenceReads++; return sourceFiles.get(path) ?? null; },
    },
  };
  for (const [path, size] of Object.entries(stats)) sourceFiles.set(path, Object.assign(new TFile(), { path, stat: { mtime: 1, ctime: 1, size } }));
  benchmarkApp = app;
  const generator = new ThumbnailWorker();
  const available = generator.available.bind(generator), generate = generator.generate.bind(generator);
  generator.available = () => { const start = performance.now(); const result = available(); imageTasks.push({ kind: "worker-availability", duration: performance.now() - start }); return result; };
  generator.generate = (buffer, eligible) => { const start = performance.now(); const result = generate(buffer, eligible); imageTasks.push({ kind: "worker-dispatch", duration: performance.now() - start }); return result; };
  if (fixture && options.scenario !== "repeat") for (let i = 0; i < 240; i++) {
    const path = `${i}-${fixture}`;
    sourceFiles.set(path, Object.assign(new TFile(), { path, asset: fixture, stat: { mtime: 1, ctime: 1, size: stats[fixture] } }));
  }
  const context: any = { getApp: () => app, store, epochs, getSettings: () => settings, getUiStrings: () => getUiStrings("en"), getViewWindow: () => window, publishGroups: publish };
  service = settings.cardImageMode === "off" ? null : oldService ?? new ThumbnailService({ storage: new ThumbnailStore(options.namespace), generator,
    isCurrent: (f) => sourceFiles.get(f.path)?.stat.mtime === f.mtime && sourceFiles.get(f.path)?.stat.size === f.size,
    read: async (f) => { originalReads++; peakReads = Math.max(peakReads, ++activeReads); try { const file = fixtureFiles.get(sourceFiles.get(f.path)?.asset ?? f.path); if (!file) throw new Error("Missing local fixture"); return await file.arrayBuffer(); } finally { activeReads--; } },
  });
  if (!baseline) controller = new CardImageController({ context, getService: () => ({ service: service!, vault: options.namespace }), isLoading: () => false });
  hydration = new HydrationController({ context, isLoading: () => false, getCommittedQuery: () => query });
  model = createPanelModel({
    strings: getUiStrings("en"), scope: { displayPath: "notes", includeSubfolders: true, activeBoxId: null, activeBoxName: null, boxExcludedCount: 0, emptyStateMessage: "", sourceIdentity: "folder:notes:true", browseTagFilterEnabled: true, browsePropertyFilterEnabled: true, supportsIncludeSubfolders: true, supportsBoxRuleSeeding: true },
    cards: cardsGroup(), search: { history: [], query: "", committedQuery: "", status: "idle", focusToken: 0 },
    projection: { sortField: "mtime", sortDirection: "desc", availableTags: [], tagCounts: {}, activeFilterTags: [], pinnedPaths: [], group: DEFAULT_GROUP_SPEC, availableGroupDimensions: [], groupSegmentCount: 0, metadataStatus: "ready" },
    bulk: { bulkMode: false, selectedPaths: [], selectedCount: 0, canBulkSelectAll: false, canBulkClearSelection: false, canBulkMoveSelected: false, canBulkDeleteSelected: false, canBulkMergeSelected: false },
    nav: { folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "single", visible: false, sectionCollapsed: {}, showItemCounts: false, tooltipSide: "right", propertyFilterCount: 0, projection: { rows: [], sections: [], normalizedQuery: "", querying: false, noResults: false }, query: "", focusId: null, focusRequest: null, revealRequest: null },
    appearance: { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2, cardImageMode: settings.cardImageMode, cardImageFit: "contain" }, images: { byPath: {}, requestVersion: 0 },
  } as any);
  const target = document.querySelector("#mount") as HTMLElement; target.style.width = `${options.columns * 250}px`; target.style.height = "720px";
  component = mount(FolderCardPanel, { target, props: { panelModel: model,
    onHydrateViewport: (request: any) => {
      void hydration!.hydrateViewport(request);
    },
    onImageViewport: (request: any) => { const start = performance.now(); controller?.requestViewport(request); imageTasks.push({ kind: "image-viewport", duration: performance.now() - start }); },
    resolveImagePlaceholder: (path: string, generation: number) => controller?.resolvePlaceholder(path, generation),
  } });
  await tick(); await nextFrame();
}
function project(query: string, paths?: string[]) {
  return runPipeline(records, stepsForScope(store.getScope()), {
    app: benchmarkApp, filterTags: [], propertyFilters: [], pinnedPaths: [],
    search: { query, execution: query ? "indexed-ready" : "browse", orderedPaths: paths },
    group: { spec: DEFAULT_GROUP_SPEC, buckets: new Map() }, collapsedGroupKeys: new Set(),
  } as any).cards;
}
async function load() {
  sample++; query = ""; controller?.beginLoad(); hydration!.resetForLoad(); hydration!.clearPreviewCache(); epochs.load.bump();
  const start = performance.now();
  records = Array.from({ length: 240 }, (_, index) => {
    const file = Object.assign(new TFile(), { path: `notes/${index}.md`, basename: `${index}`, stat: { mtime: sample, ctime: 1, size: 100 } }); sourceFiles.set(file.path, file);
    return { file, path: file.path, title: `${index} needle`, ctime: 1, mtime: sample, fileKind: "markdown", taskSummary: null, hydrated: false, previewHtml: "", previewMode: "empty", excerpt: "" };
  });
  store.replaceBaseCards(records); store.replaceVisibleCards(project(""));
  actualVisiblePaths = []; textStarted = performance.now(); textReady = 0;
  publish("cards");
  model.mutate((draft: any) => { draft.search = { ...model.getState().search, query: "", committedQuery: "" }; if (controller) draft.images = controller.getPanelState(); });
  await tick(); const cardPublish = performance.now() - start;
  void hydration!.hydrateStartupCardPaths(records.slice(0, 6).map((record) => record.path), epochs.load.token());
  for (let i = 0; !textReady && i < 200; i++) {
    await nextFrame();
    const list = document.querySelector(".fce-list")!.getBoundingClientRect();
    actualVisiblePaths = [...document.querySelectorAll(".fce-card")].filter((card) => {
      const rect = card.getBoundingClientRect(); return rect.bottom > list.top && rect.top < list.bottom;
    }).map((card) => `notes/${card.querySelector("h4")!.textContent!.split(" ")[0]}.md`);
    if (actualVisiblePaths.length && actualVisiblePaths.every((path) => store.getBaseCard(path)?.hydrated)) textReady = performance.now() - textStarted;
  }
  if (!textReady) throw new Error("Visible text did not settle");
  return { cardPublish, textReady };
}
async function search() {
  query = "needle"; hydration!.resetForLoad(); store.advanceHydrationRevision();
  const start = performance.now();
  // Ready indexed membership is supplied to the production projection. Index build is deliberately outside this UI diagnostic.
  store.replaceVisibleCards(project(query, records.filter((record, index) => index % 3 === 0).map((record) => record.path)));
  model.batch((draft: any) => { draft.cards = cardsGroup(); draft.search = { ...model.getState().search, query, committedQuery: query, status: "ready" }; });
  await tick(); return performance.now() - start;
}
async function restoreBrowse() {
  if (!records.length) return;
  query = "";
  store.replaceVisibleCards(project(""));
  model.batch((draft: any) => { draft.cards = cardsGroup(); draft.search = { ...model.getState().search, query: "", committedQuery: "" }; });
  await tick(); await settleImages();
}
async function scroll() {
  const list = document.querySelector(".fce-list") as HTMLElement;
  for (let i = 0; i < 10; i++) { list.scrollTop = i * 600; list.dispatchEvent(new Event("scroll")); await nextFrame(); }
  for (let i = 9; i >= 0; i--) { list.scrollTop = i * 600; list.dispatchEvent(new Event("scroll")); await nextFrame(); }
  return { scrollTop: list.scrollTop, heldUrls: heldUrls.size, service: service?.getDiagnostics() };
}
async function settleImages() {
  for (let i = 0; i < 600; i++) {
    await nextFrame();
    if (!service?.getDiagnostics().jobs) { await nextFrame(); if (!service?.getDiagnostics().jobs) return; }
    await wait(20);
  }
  throw new Error("Images did not settle " + JSON.stringify(service?.getDiagnostics()));
}

async function layoutCheck() {
  await settleImages(); await nextFrame();
  const list = document.querySelector(".fce-list") as HTMLElement;
  list.scrollTop = 900; list.dispatchEvent(new Event("scroll")); await settleImages(); await nextFrame();
  const leadingRow = () => {
    const top = list.getBoundingClientRect().top;
    const row = [...document.querySelectorAll(".fce-wall-row")].find((row) => row.getBoundingClientRect().bottom > top);
    return row ? { title: row.querySelector("h4")?.textContent, offset: row.getBoundingClientRect().top - top } : null;
  };
  const before = list.scrollTop, anchorBefore = leadingRow();
  settings.cardImageMode = "inline"; model.mutate((draft: any) => { draft.appearance = { ...model.getState().appearance, cardImageMode: "inline" }; });
  await nextFrame(); await nextFrame(); await nextFrame();
  if (!Number.isFinite(list.scrollTop) || list.scrollTop < 0 || list.scrollTop > list.scrollHeight) throw new Error("Invalid scroll after mode switch");
  const anchorAfter = leadingRow();
  if (anchorBefore && anchorAfter && (anchorBefore.title !== anchorAfter.title || Math.abs(anchorBefore.offset - anchorAfter.offset) > 2)) throw new Error("Image layout switch lost the reading anchor " + JSON.stringify({ anchorBefore, anchorAfter }));
  const image = document.querySelector(".fce-card-image") as HTMLElement;
  if (image && Math.abs(image.getBoundingClientRect().height - 160) > 1) throw new Error("Inline height is not 160px");
  settings.cardImageFit = "cover"; model.mutate((draft: any) => { draft.appearance = { ...model.getState().appearance, cardImageFit: "cover" }; }); await tick();
  if (image?.querySelector("img") && getComputedStyle(image.querySelector("img")!).objectFit !== "cover") throw new Error("Cover setting not applied");
  return { before, after: list.scrollTop, anchorBefore, anchorAfter };
}
async function formatChecks() {
  const canvas = new OffscreenCanvas(320, 160), context = canvas.getContext("2d")!;
  context.fillStyle = "red"; context.fillRect(0, 0, 160, 160);
  context.fillStyle = "blue"; context.fillRect(160, 0, 160, 160);
  const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
  const exif = new Uint8Array(36), view = new DataView(exif.buffer);
  view.setUint16(0, 0xffe1); view.setUint16(2, 34); exif.set(new TextEncoder().encode("Exif\0\0II"), 4);
  view.setUint16(12, 42, true); view.setUint32(14, 8, true); view.setUint16(18, 1, true);
  view.setUint16(20, 0x112, true); view.setUint16(22, 3, true); view.setUint32(24, 1, true); view.setUint16(28, 6, true);
  const oriented = new Uint8Array(jpeg.length + exif.length); oriented.set(jpeg.slice(0,2)); oriented.set(exif,2); oriented.set(jpeg.slice(2),38);
  const webp = await (await canvas.convertToBlob({ type: "image/webp" })).arrayBuffer();
  const bmp = new Uint8Array(54 + 100 * 50 * 3), bmpView = new DataView(bmp.buffer);
  bmp.set(new TextEncoder().encode("BM")); bmpView.setUint32(2,bmp.length,true); bmpView.setUint32(10,54,true); bmpView.setUint32(14,40,true);
  bmpView.setInt32(18,100,true); bmpView.setInt32(22,50,true); bmpView.setUint16(26,1,true); bmpView.setUint16(28,24,true);
  bmp.fill(150,54);
  const worker = new ThumbnailWorker(), result = [];
  for (const [format, buffer, width, height] of [["jpeg-exif-6",oriented.buffer,160,320],["webp",webp,320,160],["bmp",bmp.buffer,100,50]] as const) {
    let eligible = false;
    const thumbnail = await worker.generate(buffer, () => { eligible = true; });
    if (!eligible || thumbnail.status !== "ready") throw new Error(`Real Worker did not decode ${format}`);
    const bitmap = await createImageBitmap(thumbnail.blob);
    if (bitmap.width !== width || bitmap.height !== height) throw new Error(`Wrong ${format} output dimensions ${bitmap.width}x${bitmap.height}`);
    if (format === "jpeg-exif-6") {
      const pixels = new OffscreenCanvas(width,height), drawing = pixels.getContext("2d")!; drawing.drawImage(bitmap,0,0);
      const top = [...drawing.getImageData(80,80,1,1).data], bottom = [...drawing.getImageData(80,240,1,1).data];
      if (top[0] < 200 || top[2] > 50 || bottom[2] < 200 || bottom[0] > 50) throw new Error("JPEG orientation did not rotate the pixels");
      pixels.width = pixels.height = 0;
    }
    result.push({ format, width: bitmap.width, height: bitmap.height, type: thumbnail.blob.type }); bitmap.close();
  }
  const corrupted = new Uint8Array(await fixtureFiles.get("regular.png")!.arrayBuffer()); corrupted[50] ^= 255;
  const failure = await worker.generate(corrupted.buffer, () => undefined);
  if (failure.status !== "failed") throw new Error("Corrupt PNG was not rejected after header eligibility");
  worker.dispose(); canvas.width = canvas.height = 0;
  return { formats: result, corrupted: failure.status };
}
(window as any).imageBenchmark = { open, load, search, restoreBrowse, scroll, close, formatChecks,
  setFixtureFiles: (files: File[]) => { fixtureFiles = new Map(files.map((file) => [file.name, file])); }, settleImages, layoutCheck,
  diagnostics: () => ({ textReads, originalReads, peakReads, metadataReads, referenceReads, heldUrls: heldUrls.size, urlPeak, blobBytes, longTasks: [...longTasks], imageTasks: [...imageTasks], service: service?.getDiagnostics() }),
  resetCounters: () => { referenceReads = textReads = originalReads = peakReads = metadataReads = blobBytes = urlPeak = 0; longTasks.length = 0; imageTasks.length = 0; },
};
