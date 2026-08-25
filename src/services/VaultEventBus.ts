import type { VaultEventListener, VaultMutationEvent } from "./vault-events";

export type { VaultEventListener };

export class VaultEventBus {
  private readonly listeners: VaultEventListener[] = [];
  private deliveryTail: Promise<void> = Promise.resolve();
  private disposed = false;
  private generation = 0;

  subscribe(listener: VaultEventListener): () => void {
    if (this.disposed) return () => undefined;
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
    if (this.disposed) return Promise.resolve();
    const listeners = this.listeners.slice();
    const generation = this.generation;
    const deliver = async (): Promise<void> => {
      for (const listener of listeners) {
        if (this.disposed || generation !== this.generation) return;
        try {
          await listener(event);
        } catch (error) {
          if (this.disposed || generation !== this.generation) return;
          console.warn("[Card Workspace] Vault event listener failed.", error);
        }
      }
    };
    const completion = this.deliveryTail.then(deliver, deliver);
    this.deliveryTail = completion.catch(() => undefined);
    return completion;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.listeners.splice(0);
  }
}
