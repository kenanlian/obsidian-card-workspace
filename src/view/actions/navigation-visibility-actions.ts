import { normalizeHiddenFolderPaths, normalizeHiddenTagPaths, normalizeHiddenNavSections } from "../../navigation-visibility";
import type { ViewContext } from "../view-context";

export async function hideNavigationEntry(
  context: ViewContext, key: "hiddenFolderPaths" | "hiddenTagPaths" | "hiddenNavSections", value: string,
): Promise<void> {
  const values = [...context.getSettings()[key], value];
  const patch = key === "hiddenFolderPaths" ? { hiddenFolderPaths: normalizeHiddenFolderPaths(values) }
    : key === "hiddenTagPaths" ? { hiddenTagPaths: normalizeHiddenTagPaths(values) }
    : { hiddenNavSections: normalizeHiddenNavSections(values) };
  try { await context.saveSettings(patch); }
  catch (error) {
    console.warn("Card Workspace: navigation visibility save failed", error);
    context.notify(context.getUiStrings().navigationVisibility.saveFailedNotice);
  }
}
