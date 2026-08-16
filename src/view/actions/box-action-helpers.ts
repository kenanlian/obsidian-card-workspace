import type { UiStrings } from "../../i18n";
import type { Rule } from "../types";

/** `Foo.excalidraw.md` keeps the `.excalidraw` half. */
const CARD_FILE_EXTENSIONS = [".md", ".canvas", ".base"];

export function stripCardFileExtension(fileName: string): string {
  for (const extension of CARD_FILE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return fileName.slice(0, -extension.length);
    }
  }
  return fileName;
}

export function describeBoxRule(strings: UiStrings, rule: Rule): string {
  const boxStrings = strings.box;
  let label = rule.folder === "" ? boxStrings.ruleRootLabel : rule.folder;
  if (rule.includeSubfolders) {
    label += ` (${boxStrings.ruleSubfolderSuffix})`;
  }
  if (rule.tags.length > 0) {
    label += boxStrings.ruleTagsSeparator + rule.tags.map((tag) => `#${tag}`).join(", ");
  }
  return label;
}

export function deriveDefaultBoxNameFromBrowseScope(scope: {
  folder: string;
  tags: string[];
}): string {
  if (scope.folder !== "") {
    const segments = scope.folder.split("/");
    return segments[segments.length - 1] ?? scope.folder;
  }
  if (scope.tags.length > 0) {
    return `#${scope.tags[0]}`;
  }
  return "";
}
