/** Candidate-only integration lane. Legacy comparative rendering stays separate. */
import {mount, unmount, tick} from "svelte";
import {TFile} from "obsidian";
import FolderCardPanel from "../../src/view/FolderCardPanel.svelte";
import {createPanelModel} from "../../src/view/panel-model";
import {createViewStateStore} from "../../src/view/view-state-store";
import {createViewEpochs} from "../../src/view/view-epochs";
import {createFolderScope} from "../../src/view/scope";
import {SearchController} from "../../src/view/controllers/SearchController";
import {HydrationController} from "../../src/view/controllers/HydrationController";
import {ProjectionController} from "../../src/view/controllers/ProjectionController";
import {RuntimeWorkGate} from "../../src/runtime/work-gate";
import {resolveRuntimeResourceBudget} from "../../src/runtime/resource-budget";
import {DEFAULT_SETTINGS} from "../../src/settings";
import {DEFAULT_GROUP_SPEC} from "../../src/card-grouping-settings";
import {getUiStrings} from "../../src/i18n";
import {lifecycleFixtures} from "../search-preview-fixtures.mjs";

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const check = (condition: unknown, message: string) => {if (!condition) throw new Error(message);};
const longTasks: {start: number; duration: number}[] = [];
new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, duration: entry.duration})))).observe({type: "longtask"});

async function runScenario({delayMs = 1, device = "desktop"} = {}) {
  const resourceBudget = resolveRuntimeResourceBudget(device as any);
  const fixtures = lifecycleFixtures(), sources = new Map(fixtures.map((fixture: any) => [fixture.path, fixture.markdown]));
  const settings = {...DEFAULT_SETTINGS, searchPreviewSnippetCount: 2, previewLines: 5, cardImageMode: "off"};
  const store = createViewStateStore(createFolderScope("lifecycle", true)), epochs = createViewEpochs(), gate = new RuntimeWorkGate();
  const records = fixtures.map((fixture: any) => ({...fixture, excerpt: "", fileKind: "markdown", hydrated: false, previewHtml: "", previewMode: "empty", taskSummary: null,
    file: Object.assign(new TFile(), {path: fixture.path, basename: fixture.title, extension: "md", stat: {mtime: 2, ctime: 1, size: fixture.markdown.length}})}));
  records[1].title = "Needle title-only note";
  sources.set(records[1].path, "Ordinary opening without a body match.");
  const titleOnlyPath = records[1].path;
  const files = new Map(records.map((card: any) => [card.path, card.file]));
  store.replaceBaseCards(records); store.replaceVisibleCards(records);
  let active = 0, peak = 0, phase = "mount", model: any, search: SearchController, hydration: HydrationController, projection: ProjectionController;
  let latestRequest: any = null, lastCommand = Promise.resolve();
  const requests: any[] = [], publications: any[] = [], reads: any[] = [], commands: any[] = [];
  const requestedPaths = new Set<string>(), actualDemandedPaths = new Set<string>();
  const cardsGroup = () => ({records: store.getVisibleCards(), searchMatchCountsByPath: search?.getMatchCountsByPath() ?? {}, selectedPath: null,
    loading: false, generation: epochs.load.value, sequenceRevision: store.getVisibleSequenceRevision(), hydrationRevision: store.getHydrationRevision(), groupSegments: [], groupRevision: 0, extentCount: store.getVisibleCards().length});
  const searchGroup = () => ({history: [], query: search.getQuery(), committedQuery: search.getCommittedQuery(), status: search.getStatus(), focusToken: 0});
  const publish = (...groups: string[]) => {
    if (!model) return;
    if (groups.includes("cards") || groups.includes("search")) {
      const query = search.getCommittedQuery();
      const previews = store.getVisibleCards().map(card => card.searchPreview);
      check(previews.every(preview => !preview || preview.query === query), "Publication mixed committed queries");
      publications.push({at: performance.now(), phase, query, count: previews.length, pending: previews.filter(p => p?.status === "pending").length, ready: previews.filter(p => p?.status === "hits" || p?.status === "title-only").length, bodyHits: previews.filter(p => p?.status === "hits").length, titleOnly: previews.filter(p => p?.status === "title-only").length});
    }
    model.batch((draft: any) => {if (groups.includes("cards")) draft.cards = cardsGroup(); if (groups.includes("search")) draft.search = searchGroup();});
  };
  const app = {vault: {getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: async (file: any) => {
      const record = {path: file.path, phase, query: search.getCommittedQuery(), requested: requestedPaths.has(file.path), realVisible: actualDemandedPaths.has(file.path), start: performance.now(), end: 0};
      reads.push(record); peak = Math.max(peak, ++active);
      try {await wait(delayMs); return sources.get(file.path);} finally {active--; record.end = performance.now();}
    }}, metadataCache: {getFileCache: () => ({tags: []})}};
  const context: any = {store, epochs, workGate: gate, resourceBudget, getApp: () => app, getSettings: () => settings, getUiStrings: () => getUiStrings("en"), getViewWindow: () => window, publishGroups: publish,
    saveSettings: async () => {}, requestUpdate: async () => {}, notify: () => {}};
  const snapshot: any = {mode: "indexed", status: "ready", initialized: true, disposed: false, contentRevision: 1, indexGeneration: 1, health: {outcome: "healthy", persistence: "ready"}};
  const service: any = {query: async ({query, candidatePaths}: any) => ({execution: "indexed-ready", orderedPaths: candidatePaths,
    matchCountsByPath: Object.fromEntries(candidatePaths.map((path: string) => [path, path === titleOnlyPath ? 1 : 340])), matchFieldsByPath: Object.fromEntries(candidatePaths.map((path: string) => [path, path === titleOnlyPath ? ["title"] : ["content"]]))})};
  search = new SearchController({context, getSearchService: () => service, getSearchSnapshot: () => snapshot, subscribeSearchSnapshots: () => () => {},
    publishSearchProjection: () => {projection.reprojectCards(); publish("cards", "search");},
    prepareSearchProjection: (query, result, revision, isCurrent) => hydration.prepareSearchProjection(projection.previewSearchCards({query, execution: result.execution, orderedPaths: result.orderedPaths ?? []}),
      {query, revision, matchFieldsByPath: result.matchFieldsByPath ?? {}, isCurrent})});
  hydration = new HydrationController({context, isLoading: () => false, getCommittedQuery: () => search.getCommittedQuery(), getSearchContentRevision: () => search.getContentRevision(),
    isCommittedQueryCurrent: () => search.isCommittedQueryCurrent(), getMatchFields: path => search.getMatchFields(path)});
  projection = new ProjectionController({context, getSearchInput: () => search.buildPipelineSearchInput(), getEffectivePinnedPaths: () => [], getLoadKey: () => "lifecycle", getGroupConfig: () => DEFAULT_GROUP_SPEC, getCollapsedGroupKeys: () => new Set()});
  search.initializeSnapshotState();
  model = createPanelModel({
    strings: getUiStrings("en"), scope: {displayPath: "lifecycle", includeSubfolders: true, activeBoxId: null, activeBoxName: null, boxExcludedCount: 0, emptyStateMessage: "", sourceIdentity: "folder:lifecycle:true", browseTagFilterEnabled: true, browsePropertyFilterEnabled: true, supportsIncludeSubfolders: true, supportsBoxRuleSeeding: true},
    cards: cardsGroup(), search: searchGroup(),
    projection: {sortField: "mtime", sortDirection: "desc", availableTags: [], tagCounts: {}, activeFilterTags: [], pinnedPaths: [], group: DEFAULT_GROUP_SPEC, availableGroupDimensions: [], groupSegmentCount: 0, metadataStatus: "ready"},
    bulk: {bulkMode: false, selectedPaths: [], selectedCount: 0, canBulkSelectAll: false, canBulkClearSelection: false, canBulkMoveSelected: false, canBulkDeleteSelected: false, canBulkMergeSelected: false},
    nav: {folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "single", visible: false, sectionCollapsed: {}, showItemCounts: false, tooltipSide: "right", propertyFilterCount: 0, projection: {rows: [], sections: [], normalizedQuery: "", querying: false, noResults: false}, query: "", focusId: null, focusRequest: null, revealRequest: null},
    appearance: {cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2, cardImageMode: "off", cardImageFit: "contain"}, images: {byPath: {}, requestVersion: 0},
  } as any);
  const target = document.querySelector<HTMLElement>("#mount")!; target.innerHTML = ""; target.style.width = device === "phone" ? "280px" : "380px"; target.style.height = "640px";
  const component = mount(FolderCardPanel, {target, props: {panelModel: model, runtimeDevice: device,
    onHydrateViewport: (request: any) => {
      latestRequest = request; requestedPaths.clear(); request.paths.forEach((path: string) => requestedPaths.add(path));
      const realPaths = store.getVisibleCards().slice(request.visibleStart, request.visibleEnd).map(card => card.path);
      actualDemandedPaths.clear(); realPaths.forEach(path => actualDemandedPaths.add(path));
      requests.push({...request, paths: [...request.paths], at: performance.now(), phase, realPaths});
      void hydration.hydrateViewport(request);
    }, onSearchSnippetsCommand: (payload: any) => {
      commands.push({...payload, at: performance.now()}); lastCommand = hydration.changeSearchSnippets(payload.path, payload.command);
    }} as any});
  const settle = async () => {for (let count = 0; count < 1200; count++) {const d = hydration.getDiagnostics(); if (!d.active && !d.queued) {await tick(); await frame(); if (!hydration.getDiagnostics().active && !hydration.getDiagnostics().queued) return;} await wait(5);} throw new Error("Production hydration did not drain");};
  const visibleCards = () => {
    const list = target.querySelector<HTMLElement>(".fce-list")!, bounds = list.getBoundingClientRect();
    return [...target.querySelectorAll<HTMLElement>(".fce-card")].filter(card => {const rect = card.getBoundingClientRect(); return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;});
  };
  const pathOf = (card: HTMLElement) => store.getVisibleCards().find(record => card.querySelector("h4")?.textContent?.trim() === record.title)?.path;
  const captureVisible = () => visibleCards().map(card => {const path = pathOf(card), excerpt = card.querySelector<HTMLElement>(".fce-excerpt"); return {path, top: card.getBoundingClientRect().top, height: card.getBoundingClientRect().height,
    status: path ? store.getBaseCard(path)?.searchPreview?.status : undefined, pending: !!card.querySelector(".is-search-pending"), snippets: card.querySelectorAll(".fce-search-snippet").length,
    placeholders: card.querySelectorAll(".fce-search-pending-lines").length, lineClamp: excerpt ? Number(getComputedStyle(excerpt).getPropertyValue("--fce-preview-line-clamp")) : 0};});
  const assertBounds = () => {
    check(latestRequest && Number.isInteger(latestRequest.visibleStart) && Number.isInteger(latestRequest.visibleEnd), "Panel omitted real visible bounds");
    const actualPaths = captureVisible().map(card => card.path);
    const boundsPaths = store.getVisibleCards().slice(latestRequest.visibleStart, latestRequest.visibleEnd).map(card => card.path);
    check(actualPaths.every(path => boundsPaths.includes(path!)), "Real visible bounds excluded a visible card");
    return {actualPaths, start: latestRequest.start, end: latestRequest.end, visibleStart: latestRequest.visibleStart, visibleEnd: latestRequest.visibleEnd};
  };
  const started = performance.now();
  try {
    await tick(); await frame(); await settle();
    phase = "initial-search";
    if (delayMs > resourceBudget.searchPreview.prepareWaitMs) hydration.clearPreviewCache();
    const publicationStart = publications.length, commitStart = performance.now();
    search.onQueryChange({query: "needle"}); search.clearDebounce();
    const pendingCommit = search.refreshProjection();
    await Promise.resolve();
    check(search.getCommittedQuery() === "", "Draft committed before preparation settled");
    check(model.getState().search.committedQuery === "", "Panel committed draft early");
    await pendingCommit; await tick(); await frame();
    const commitMs = performance.now() - commitStart, initialVisible = captureVisible(), bounds = assertBounds();
    check(search.getCommittedQuery() === "needle", "Search controller did not commit");
    const commits = publications.slice(publicationStart).filter(p => p.query === "needle");
    check(commits.length > 0 && commits[0].ready + commits[0].pending === records.length, "Initial transaction omitted prepared/pending previews");
    check(initialVisible.length > 0 && initialVisible.every(card => card.height > 0 && (card.pending || card.snippets > 0 || card.status === "title-only")), "Visible first result was blank or unmeasurable");
    const timeoutPending = initialVisible.filter(card => card.pending).length;
    if (delayMs > resourceBudget.searchPreview.prepareWaitMs) {
      check(timeoutPending > 0, "Slow-source scenario did not exercise pending timeout");
      const pendingTitle = initialVisible.find(card => card.path === titleOnlyPath);
      check(pendingTitle?.pending && pendingTitle.placeholders === 1 && pendingTitle.lineClamp === settings.previewLines, "Title-only pending geometry did not reserve previewLines " + JSON.stringify(pendingTitle));
      check(initialVisible.filter(card => card.pending && card.path !== titleOnlyPath).every(card => card.placeholders === 2 && card.lineClamp === 4), "Body pending geometry did not reserve configured snippets");
    }
    await settle();
    check(captureVisible().every(card => !card.pending && (card.snippets === 2 || card.path === titleOnlyPath && card.status === "title-only")), "Visible timeout fallback did not resolve");
    const afterPreparation = hydration.getDiagnostics();
    phase = "scroll";
    const list = target.querySelector<HTMLElement>(".fce-list")!, viewport = list.clientHeight, scrollSamples: any[] = [], scrollLegs: any[] = [];
    const scrollLeg = async (direction: number) => {
      const beginning = performance.now(), startScroll = list.scrollTop;
      let previous = beginning;
      while (performance.now() - beginning < 1250) {
        await frame(); const now = performance.now(), elapsed = now - beginning;
        list.scrollTop = Math.max(0, startScroll + direction * viewport * 2 * elapsed / 1000); list.dispatchEvent(new Event("scroll"));
        await tick();
        const visible = captureVisible(); scrollSamples.push({at: now, frameMs: now - previous, direction, scrollTop: list.scrollTop, visible: visible.length, pending: visible.filter(card => card.pending || !card.snippets && card.status !== "title-only").length}); previous = now;
      }
      const end = performance.now();
      scrollLegs.push({direction, durationMs: end - beginning, pixels: list.scrollTop - startScroll, measuredViewportsPerSecond: Math.abs(list.scrollTop - startScroll) / viewport / ((end - beginning) / 1000)});
    };
    await scrollLeg(1); await scrollLeg(-1); await settle(); await frame();
    const scrolledBounds = assertBounds();
    phase = "expand";
    // Choose the first fully visible card and keep the interaction at its top.
    const chosen = visibleCards().find(card => card.querySelector(".fce-search-snippets-toggle") && card.getBoundingClientRect().top >= list.getBoundingClientRect().top) ?? visibleCards().find(card => card.querySelector(".fce-search-snippets-toggle"))!;
    const path = pathOf(chosen)!; check(!!path, "Cannot locate expansion card");
    const locate = () => [...target.querySelectorAll<HTMLElement>(".fce-card")].find(card => pathOf(card) === path)!;
    const relativeTop = () => locate().getBoundingClientRect().top - list.getBoundingClientRect().top;
    const anchorTop = relativeTop(), expansion: any[] = [];
    const command = async (kind: string) => {
      const card = locate(), controls = [...card.querySelectorAll<HTMLButtonElement>(".fce-search-snippets-toggle")];
      check(controls.length > 0, "Search expansion controls missing");
      const button = kind === "collapse" ? controls.at(-1)! : controls[0];
      const beforeCount = store.getBaseCard(path)!.searchPreview!.snippets.length, commandStart = performance.now();
      button.click(); await lastCommand; await tick(); await frame(); await frame();
      const preview = store.getBaseCard(path)!.searchPreview!;
      const value = {command: kind, beforeCount, count: preview.snippets.length, total: preview.totalSnippets, snippetLimit: preview.snippetLimit, durationMs: performance.now() - commandStart, anchorOffset: relativeTop(), anchorDelta: Math.abs(relativeTop() - anchorTop)};
      check(value.snippetLimit === 2, "Expansion changed configured snippet limit");
      check(value.anchorDelta <= 2, "Expansion moved selected card anchor " + JSON.stringify(value));
      if (kind !== "collapse") check(value.count === Math.min(value.total!, beforeCount + 20), "Expansion did not append one page");
      expansion.push(value);
    };
    await command("expand");
    for (let page = 0; store.getBaseCard(path)!.searchPreview!.snippets.length < 202 && page < 20; page++) await command("more");
    check(store.getBaseCard(path)!.searchPreview!.snippets.length >= 202, "Hundreds-snippet stress did not expand hundreds of snippets");
    const expandedDomSnippets = locate().querySelectorAll(".fce-search-snippet").length;
    await command("collapse"); check(store.getBaseCard(path)!.searchPreview!.snippets.length === 2, "Collapse did not restore compact limit");
    await settle();
    phase = "hidden"; gate.setActive(false); const beforeHidden = reads.length;
    const request = {...latestRequest, start: 120, end: 126, visibleStart: 120, visibleEnd: 126, paths: records.slice(120, 126).map((card: any) => card.path)};
    void hydration.hydrateViewport(request);
    search.onQueryChange({query: "need"}); search.clearDebounce(); await search.refreshProjection(); await wait(50);
    check(reads.length === beforeHidden, "Hidden viewport started source reads");
    const hidden = {reads: reads.length - beforeHidden, diagnostics: hydration.getDiagnostics()};
    // Closing the gate before disposal releases its waiters without new work.
    gate.close(); hydration.dispose(); search.dispose();
    const diagnostics = hydration.getDiagnostics(), readsByPath = new Map<string, number>();
    for (const read of reads.filter(read => read.phase !== "mount")) readsByPath.set(read.path, (readsByPath.get(read.path) ?? 0) + 1);
    const repeatReads = [...readsByPath].filter(([, count]) => count > 1);
    const initialReadCounts = new Map<string, number>();
    for (const read of reads.filter(read => read.phase === "initial-search")) initialReadCounts.set(read.path, (initialReadCounts.get(read.path) ?? 0) + 1);
    const duplicateInitialReads = [...initialReadCounts].filter(([, count]) => count > 1);
    check(duplicateInitialReads.length === 0, "Preparation timeout and hydration duplicated source reads " + JSON.stringify(duplicateInitialReads));
    check(peak <= resourceBudget.preview.concurrency, "Production read concurrency exceeded budget");
    return {device, delayMs, budget: resourceBudget.searchPreview, durationMs: performance.now() - started, commitMs, timeoutPending, initialVisible, bounds, scrolledBounds,
      afterPreparation, diagnostics, reads: {total: reads.length, browseMountReads: reads.filter(read => read.phase === "mount").length, searchUniquePaths: readsByPath.size, demand: reads.filter(read => read.requested).length, outsideDemand: reads.filter(read => !read.requested).length, realVisibleAtStart: reads.filter(read => read.realVisible).length, peak, repeatReads, duplicateInitialReads, raw: reads},
      scroll: {targetViewportsPerSecond: 2, targetLegDurationMs: 1250, legs: scrollLegs, samples: scrollSamples, maxPendingVisible: Math.max(...scrollSamples.map(sample => sample.pending))},
      expansion: {path, expandedDomSnippets, steps: expansion}, hidden, requests, publications, commands, longTasks: longTasks.filter(task => task.start >= started)};
  } finally {gate.close(); hydration.dispose(); search.dispose(); await unmount(component);}
}
(window as any).searchPreviewProduction = {run: async () => ({fast: await runScenario(), timeout: await runScenario({delayMs: 180}), phone: await runScenario({device: "phone"})})};
