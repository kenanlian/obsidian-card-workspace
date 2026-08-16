import { AsyncEpoch } from "./async-epoch";

/** Invalidation clocks shared across controller ownership boundaries. */
export interface ViewEpochs {
  /** One scope load and its hydration work share this generation. */
  readonly load: AsyncEpoch;
  /** Vault-derived projection caches expire against this generation. */
  readonly vaultContent: AsyncEpoch;
  /** Navigation counts advance once per debounced refresh. */
  readonly navCount: AsyncEpoch;
}

export function createViewEpochs(): ViewEpochs {
  return {
    load: new AsyncEpoch(),
    vaultContent: new AsyncEpoch(),
    navCount: new AsyncEpoch(),
  };
}
