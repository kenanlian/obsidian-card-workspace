// Vitest mock for FolderCardPanel.svelte dynamic import in FolderCardView.onOpen()
// Enables capturing $on() handlers for test verification
const mockState = (globalThis as any).__mockState || {};

export default class MockFolderCardPanel {
  $on(eventName: string, handler: (event: any) => void): () => void {
    if (!mockState.panelEventHandlers) {
      mockState.panelEventHandlers = {};
    }
    mockState.panelEventHandlers[eventName] = handler;
    return () => delete mockState.panelEventHandlers[eventName];
  }

  $set(): void {
    return;
  }

  $destroy(): void {
    return;
  }
}
