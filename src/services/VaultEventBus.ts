import type { VaultEventListener, VaultMutationEvent } from "./vault-events";

export type { VaultEventListener };

export class VaultEventBus {
  private readonly listeners: VaultEventListener[] = [];

  subscribe(listener: VaultEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Await listeners in registration order. Isolate per-listener throw/reject with
   * console.warn; do not reject publish.
   */
  async publish(event: VaultMutationEvent): Promise<void> {
    const listeners = this.listeners.slice();
    for (const listener of listeners) {
      try {
        await listener(event);
      } catch (error) {
        console.warn("[Card Workspace] Vault event listener failed.", error);
      }
    }
  }
}
