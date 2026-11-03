/**
 * Inert `obsidian` module used only by the Node benchmark bundle.
 *
 * The benchmark reuses production search modules; the only transitive
 * `obsidian` import in that graph (i18n language probing through
 * `view/file-kind`) is never invoked while indexing, so a stub keeps the
 * bundle loadable in Node without pulling Obsidian runtime code into the
 * measurement.
 */
export function getLanguage(): string {
  return "en";
}
