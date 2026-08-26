import {
  navigationFolderId,
  type NavigationFocusRequest,
  type NavigationRevealRequest,
} from "../navigation-model";

export class NavigationRequests {
  private revealToken = 0;
  private focusToken = 0;
  private reveal: NavigationRevealRequest | null = null;
  private focus: NavigationFocusRequest | null = null;

  getReveal(): NavigationRevealRequest | null { return this.reveal; }
  getFocus(): NavigationFocusRequest | null { return this.focus; }

  requestReveal(rowId: string): void {
    this.reveal = { token: ++this.revealToken, rowId };
  }

  requestFocus(rowId: string): void {
    this.focus = { token: ++this.focusToken, rowId };
  }

  consumeReveal(token: number): boolean {
    if (this.reveal?.token !== token) return false;
    this.reveal = null;
    return true;
  }

  consumeFocus(token: number): boolean {
    if (this.focus?.token !== token) return false;
    this.focus = null;
    return true;
  }

  rewriteFolders(rewrite: (path: string) => string): void {
    if (!this.reveal?.rowId.startsWith("folder:")) return;
    this.reveal = {
      ...this.reveal,
      rowId: navigationFolderId(rewrite(this.reveal.rowId.slice("folder:".length))),
    };
  }

  clear(): void {
    this.reveal = null;
    this.focus = null;
  }
}
