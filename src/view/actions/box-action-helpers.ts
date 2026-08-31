export { describeBoxRule } from "../box-rule-identity";

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
