import type { CardFileKind } from "../view/file-kind";

export type VaultMutationEventType = "create" | "modify" | "delete" | "rename";

export interface VaultMutationEvent {
  eventType: VaultMutationEventType;
  path: string;
  oldPath: string | null;
  isFolder: boolean;
  fileKind: CardFileKind | null;
}

export type VaultEventListener = (event: VaultMutationEvent) => void | Promise<void>;
