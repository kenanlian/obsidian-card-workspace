// Vitest stub for the Electron runtime Obsidian provides but the test env does not.
export const shell = {
  openPath: async (_path: string): Promise<string> => "",
  showItemInFolder: (_path: string): void => undefined,
};
