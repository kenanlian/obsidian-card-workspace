import type { PluginSettings } from "../settings";
import { reconcileBoxForVaultMutation } from "../view/card-boxes";
import type { UserDataSettings } from "./SettingsStore";
import type { VaultMutationEvent } from "./vault-events";

export interface BoxReconcilerDeps {
  getSettings: () => PluginSettings;
  updateUserData: (patch: Partial<UserDataSettings>) => Promise<unknown>;
  onUserDataReconciled: () => void;
  onStep?: (step: string) => void;
}

/**
 * Owns box path/rule rewrite against vault rename and delete events.
 */
export class BoxReconciler {
  onStep?: (step: string) => void;

  private readonly getSettings: () => PluginSettings;
  private readonly updateUserData: (patch: Partial<UserDataSettings>) => Promise<unknown>;
  private readonly onUserDataReconciled: () => void;

  constructor(deps: BoxReconcilerDeps) {
    this.getSettings = deps.getSettings;
    this.updateUserData = deps.updateUserData;
    this.onUserDataReconciled = deps.onUserDataReconciled;
    this.onStep = deps.onStep;
  }

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    this.onStep?.("boxes");
    const boxes = this.getSettings().boxes;
    if (boxes.length === 0) {
      return;
    }

    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    let changed = false;
    const nextBoxes = boxes.map((box) => {
      const reconciled = reconcileBoxForVaultMutation(box, {
        eventType: event.eventType,
        path: event.path,
        oldPath: event.oldPath,
        isFolder: event.isFolder,
      });
      if (reconciled !== box) {
        changed = true;
      }
      return reconciled;
    });

    if (!changed) {
      return;
    }

    const persist = this.updateUserData({ boxes: nextBoxes });
    this.onUserDataReconciled();
    await persist;
  }
}
