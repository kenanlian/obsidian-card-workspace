import type { TFile } from "obsidian";

export interface NoteCardRecord {
  file: TFile;
  path: string;
  title: string;
  ctime: number;
  mtime: number;
  cover: string | null;
  excerpt: string;
  previewHtml: string;
  previewMode: "text" | "code" | "empty";
  hydrated: boolean;
}
