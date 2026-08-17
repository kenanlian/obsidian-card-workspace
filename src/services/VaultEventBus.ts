import type { VaultEventListener, VaultMutationEvent } from "./vault-events";

export type { VaultEventListener };

export class VaultEventBus {
  private readonly listeners: VaultEventListener[] = [];
  private deliveryTail: Promise<void> = Promise.resolve();

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
  publish(event: VaultMutationEvent): Promise<void> {
    const listeners = this.listeners.slice();
    const deliver = async (): Promise<void> => {
      for (const listener of listeners) {
        try {
          await listener(event);
        } catch (error) {
          console.warn("[Card Workspace] Vault event listener failed.", error);
        }
      }
    };
    const completion = this.deliveryTail.then(deliver, deliver);
    this.deliveryTail = completion.catch(() => undefined);
    return completion;
  }
}
