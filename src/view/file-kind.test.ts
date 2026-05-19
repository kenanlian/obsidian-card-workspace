import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockTFile {
    path: string;
    basename: string;
    name: string;
    extension: string;

    constructor(path: string = "") {
      this.path = path;
      this.name = path.replace(/.*\//, "");
      this.basename = this.name.replace(/\.[^.]+$/, "");
      this.extension = this.name.includes(".") ? this.name.split(".").pop() ?? "" : "";
    }
  }

  return {
    TFile: MockTFile,
  };
});

import { TFile } from "obsidian";
import { getUiStrings } from "../i18n";
import {
  getCardFileIcon,
  getCardPlaceholderText,
  isMarkdownCardKind,
  isSupportedCardFile,
  resolveCardFileKind,
  resolveCardFileKindFromPath,
} from "./file-kind";

function createFile(path: string): TFile {
  const file = new TFile();
  (file as unknown as { path: string }).path = path;
  (file as unknown as { name: string }).name = path.replace(/.*\//, "");
  (file as unknown as { basename: string }).basename = path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  (file as unknown as { extension: string }).extension = path.includes(".")
    ? path.split(".").pop() ?? ""
    : "";
  return file;
}

describe("resolveCardFileKindFromPath", () => {
  it("resolves supported card kinds including .excalidraw.md and mixed-case extensions", () => {
    expect(resolveCardFileKindFromPath("notes/note.md")).toBe("markdown");
    expect(resolveCardFileKindFromPath("notes/note.MD")).toBe("markdown");
    expect(resolveCardFileKindFromPath("notes/drawing.excalidraw.md")).toBe("excalidraw");
    expect(resolveCardFileKindFromPath("notes/drawing.EXCALIDRAW.MD")).toBe("excalidraw");
    expect(resolveCardFileKindFromPath("notes/board.canvas")).toBe("canvas");
    expect(resolveCardFileKindFromPath("notes/table.BASE")).toBe("base");
    expect(resolveCardFileKindFromPath("notes/other.txt")).toBeNull();
  });

  it("returns null for unsupported file paths", () => {
    expect(resolveCardFileKindFromPath("notes/other.txt")).toBeNull();
  });

  it("prefers excalidraw over the plain markdown suffix", () => {
    expect(resolveCardFileKindFromPath("notes/sketch.excalidraw.md")).toBe("excalidraw");
  });
});

describe("resolveCardFileKind", () => {
  it("uses the file path when resolving the kind", () => {
    expect(resolveCardFileKind(createFile("notes/drawing.excalidraw.md"))).toBe("excalidraw");
    expect(resolveCardFileKind(createFile("notes/board.canvas"))).toBe("canvas");
  });
});

describe("isSupportedCardFile", () => {
  it("returns true only for supported file kinds", () => {
    expect(isSupportedCardFile(createFile("notes/note.md"))).toBe(true);
    expect(isSupportedCardFile(createFile("notes/board.canvas"))).toBe(true);
    expect(isSupportedCardFile(createFile("notes/other.txt"))).toBe(false);
  });
});

describe("isMarkdownCardKind", () => {
  it("treats markdown as the only markdown card kind", () => {
    expect(isMarkdownCardKind("markdown")).toBe(true);
    expect(isMarkdownCardKind("base")).toBe(false);
    expect(isMarkdownCardKind("canvas")).toBe(false);
    expect(isMarkdownCardKind("excalidraw")).toBe(false);
  });
});

describe("placeholder and icon helpers", () => {
  it("returns stable placeholder text and icons for each kind", () => {
    expect(getCardPlaceholderText("markdown")).toBe("Markdown");
    expect(getCardPlaceholderText("base")).toBe("This is a base file.");
    expect(getCardPlaceholderText("canvas")).toBe("This is a canvas file.");
    expect(getCardPlaceholderText("excalidraw")).toBe("This is an excalidraw file.");

    expect(getCardFileIcon("markdown")).toBe("file-text");
    expect(getCardFileIcon("base")).toBe("layout-list");
    expect(getCardFileIcon("canvas")).toBe("layout-dashboard");
    expect(getCardFileIcon("excalidraw")).toBe("pen-tool");
  });

  it("supports localized placeholder text", () => {
    const strings = getUiStrings("zh").fileKind;
    expect(getCardPlaceholderText("base", strings)).toBe("这是一个 Base 文件。");
    expect(getCardPlaceholderText("canvas", strings)).toBe("这是一个 Canvas 文件。");
  });
});
