import type { App } from "obsidian";
import type { BulkTagsDraft } from "../bulk-metadata";
import { normalizeTagForFrontmatter } from "../note-tag-ops";
import { BulkMetadataModal, type BulkMetadataModalOptions } from "./BulkMetadataModal";

export class BulkTagsModal extends BulkMetadataModal {
  private readonly draft: BulkTagsDraft = { addTags: [], removeTags: [] };
  constructor(app: App, options: BulkMetadataModalOptions, private readonly onSubmit: (draft: BulkTagsDraft) => Promise<boolean>) { super(app, options); }
  private valid(): boolean {
    const adds = this.draft.addTags.map(normalizeTagForFrontmatter);
    const removes = this.draft.removeTags.map(normalizeTagForFrontmatter);
    return adds.length + removes.length > 0 && !adds.some((tag) => removes.includes(tag));
  }
  protected override isSubmitDisabled(): boolean { return !this.valid(); }
  protected renderBody(): void {
    this.setTitle(this.strings.tagsTitle);
    this.renderIntro(this.strings.descendants);
    const changed = () => this.updateValidation(this.valid(), this.draft.addTags.length + this.draft.removeTags.length > 0);
    const normalize = normalizeTagForFrontmatter;
    this.renderPicker({ heading: this.strings.addTags, candidates: this.snapshot.tags, selected: this.draft.addTags, normalize, allowNew: true, onChange: changed, tone: "add" });
    this.renderPicker({ heading: this.strings.removeTags, candidates: this.snapshot.removeTags, selected: this.draft.removeTags, normalize, allowNew: false, onChange: changed, tone: "remove" });
    this.renderFeedback();
    changed();
  }
  protected handleSubmit(): Promise<boolean> { return this.onSubmit({ addTags: [...this.draft.addTags], removeTags: [...this.draft.removeTags] }); }
}
