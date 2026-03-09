import { describe, it, expect, vi } from "vitest";
import { collectAllVaultFolders, FolderPickerModal } from "./FolderPickerModal";

// Helper to create a mock TFolder object
function createMockFolder(path: string, name: string, children: any[] = []): any {
  return {
    path,
    name,
    parent: null,
    children,
    isRoot: () => path === "",
  };
}

// Helper to create a mock App with vault
function createMockApp(root: any): any {
  return {
    vault: {
      getRoot: () => root,
    },
  };
}

describe("collectAllVaultFolders", () => {
  it("collects all folders sorted by path", () => {
    // Create mock folder structure:
    // /
    //   Projects/
    //     Sub/
    //   Archive/
    const mockRoot = createMockFolder("", "");

    const projectsFolder = createMockFolder("Projects", "Projects");
    const subFolder = createMockFolder("Projects/Sub", "Sub");
    const archiveFolder = createMockFolder("Archive", "Archive");

    // Set up parent-child relationships
    projectsFolder.children = [subFolder];
    mockRoot.children = [projectsFolder, archiveFolder];

    const items = collectAllVaultFolders(mockRoot);

    // Should have root, Projects, Projects/Sub, Archive (root first, then sorted)
    expect(items).toHaveLength(4);
    expect(items[0]).toBe(mockRoot);
    expect(items[1].path).toBe("Archive");
    expect(items[2].path).toBe("Projects");
    expect(items[3].path).toBe("Projects/Sub");
  });

  it("includes vault root in suggestions", () => {
    const mockRoot = createMockFolder("", "");
    const projectsFolder = createMockFolder("Projects", "Projects");
    mockRoot.children = [projectsFolder];

    const items = collectAllVaultFolders(mockRoot);
    const hasRoot = items.some((f) => f.path === "");

    expect(hasRoot).toBe(true);
  });
});

describe("FolderPickerModal", () => {
  it("getItemText displays vault root as slash", () => {
    const mockRoot = createMockFolder("", "Root");
    const mockApp = createMockApp(mockRoot);
    const onChoose = vi.fn();

    const modal = new FolderPickerModal(mockApp, onChoose);

    expect(modal.getItemText(mockRoot)).toBe("/");
  });

  it("getItemText displays other folders by full path", () => {
    const mockRoot = createMockFolder("", "Root");
    const projectsFolder = createMockFolder("Projects", "Projects");
    mockRoot.children = [projectsFolder];

    const mockApp = createMockApp(mockRoot);
    const onChoose = vi.fn();

    const modal = new FolderPickerModal(mockApp, onChoose);

    expect(modal.getItemText(projectsFolder)).toBe("Projects");
  });

  it("onChooseItem invokes callback with the selected TFolder unchanged", () => {
    const mockRoot = createMockFolder("", "Root");
    const projectsFolder = createMockFolder("Projects", "Projects");
    const subFolder = createMockFolder("Projects/Sub", "Sub");

    projectsFolder.children = [subFolder];
    mockRoot.children = [projectsFolder];

    const mockApp = createMockApp(mockRoot);
    const onChoose = vi.fn();

    const modal = new FolderPickerModal(mockApp, onChoose);

    // Call onChooseItem with a specific folder
    modal.onChooseItem(subFolder);

    // Verify callback was called exactly once with the exact same folder object
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(subFolder);
    expect(onChoose.mock.calls[0][0]).toBe(subFolder);
  });

  it("getItems returns all collected folders including root", () => {
    const mockRoot = createMockFolder("", "Root");
    const projectsFolder = createMockFolder("Projects", "Projects");
    const archiveFolder = createMockFolder("Archive", "Archive");

    projectsFolder.children = [];
    mockRoot.children = [projectsFolder, archiveFolder];

    const mockApp = createMockApp(mockRoot);
    const onChoose = vi.fn();

    const modal = new FolderPickerModal(mockApp, onChoose);
    const items = modal.getItems();

    expect(items).toHaveLength(3);
    expect(items[0]).toBe(mockRoot);
    expect(items.some((f) => f.path === "Archive")).toBe(true);
    expect(items.some((f) => f.path === "Projects")).toBe(true);
  });

  it("callback receives TFolder object type, not a string path", () => {
    const mockRoot = createMockFolder("", "Root");
    const targetFolder = createMockFolder("Target", "Target");
    mockRoot.children = [targetFolder];

    const mockApp = createMockApp(mockRoot);
    const onChoose = vi.fn();

    const modal = new FolderPickerModal(mockApp, onChoose);
    modal.onChooseItem(targetFolder);

    const passedArg = onChoose.mock.calls[0][0];
    expect(typeof passedArg).toBe("object");
    expect(passedArg).toHaveProperty("path");
    expect(passedArg).toHaveProperty("name");
    expect(passedArg).toHaveProperty("children");
    expect(typeof passedArg.path).toBe("string");
    expect(typeof passedArg.name).toBe("string");
  });
});

