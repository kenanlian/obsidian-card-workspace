import { stripMarkdownToText } from "../view/markdown-utils";
import type { SearchRenameClassification, SearchVaultMutation, SearchableDocument } from "./types";

const EXCERPT_MAX_LENGTH = 260;

export interface SearchableDocumentInput {
  path: string;
  title: string;
  markdown: string;
  mtime: number;
  ctime: number;
}

export type SearchMutationDecisionAction =
  | "ignored"
  | "create"
  | "modify"
  | "delete"
  | "file-rename"
  | "folder-rename"
  | "rebuild-required";

export interface SearchMutationDecision {
  action: SearchMutationDecisionAction;
  renameClassification: SearchRenameClassification | null;
}

export function prepareSearchableDocument(input: SearchableDocumentInput): SearchableDocument {
  const title = input.title.trim();
  const content = stripMarkdownToText(input.markdown, Number.MAX_SAFE_INTEGER);
  const excerpt = stripMarkdownToText(input.markdown, EXCERPT_MAX_LENGTH);

  return {
    path: input.path,
    title,
    normalizedTitle: title.toLowerCase(),
    content,
    excerpt,
    folderPath: deriveFolderPath(input.path),
    mtime: input.mtime,
    ctime: input.ctime,
  };
}

export function prepareSearchableDocuments(inputs: SearchableDocumentInput[]): SearchableDocument[] {
  return inputs.map((input) => prepareSearchableDocument(input));
}

export function classifySearchMutation(event: SearchVaultMutation): SearchMutationDecision {
  if (event.type === "rename") {
    return classifyRenameMutation(event);
  }

  if (event.isFolder || !event.isMarkdown) {
    return {
      action: "ignored",
      renameClassification: null,
    };
  }

  return {
    action: event.type,
    renameClassification: null,
  };
}

function classifyRenameMutation(event: SearchVaultMutation): SearchMutationDecision {
  if (!event.oldPath || event.oldPath.trim().length === 0) {
    return {
      action: "rebuild-required",
      renameClassification: "folder-rebuild-required",
    };
  }

  if (event.isFolder) {
    if (canSafelyRewriteFolderPrefix(event.oldPath, event.path)) {
      return {
        action: "folder-rename",
        renameClassification: "folder-safe-prefix-rewrite",
      };
    }

    return {
      action: "rebuild-required",
      renameClassification: "folder-rebuild-required",
    };
  }

  if (!event.isMarkdown) {
    return {
      action: "ignored",
      renameClassification: null,
    };
  }

  return {
    action: "file-rename",
    renameClassification: "file",
  };
}

function canSafelyRewriteFolderPrefix(oldPath: string, newPath: string): boolean {
  const normalizedOld = oldPath.trim();
  const normalizedNew = newPath.trim();
  if (normalizedOld.length === 0 || normalizedNew.length === 0 || normalizedOld === normalizedNew) {
    return false;
  }

  // Defensive guard: avoid recursive/overlapping prefix rewrites that can corrupt path mapping.
  if (
    normalizedNew.startsWith(`${normalizedOld}/`) ||
    normalizedOld.startsWith(`${normalizedNew}/`)
  ) {
    return false;
  }

  return true;
}

function deriveFolderPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return "";
  }

  return path.slice(0, separatorIndex);
}
