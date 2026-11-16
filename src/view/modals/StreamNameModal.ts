import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { FormModal } from "./FormModal";

/** Research names belong to a stream and may be cleared to resume source naming. */
export class StreamNameModal extends FormModal {
  private value: string;
  constructor(app: App, private readonly options: {
    strings: UiStrings; title: string; name: string | null; sourceLabel: string; language: string;
    submit: (name: string | null) => void;
  }) {
    super(app, { cancel: options.strings.box.cancel, submit: options.title, submitting: options.title });
    this.value = options.name ?? "";
  }
  protected renderBody(): void {
    this.setTitle(this.options.title);
    const zh = this.options.language === "zh";
    new Setting(this.contentEl).setName(zh ? "名称" : "Name")
      .setDesc(zh ? "留空以使用来源名称。" : "Leave empty to use the source name.")
      .addText(text => {
        text.setValue(this.value).setPlaceholder(this.options.sourceLabel).onChange(value => { this.value = value; });
        this.submitOnEnter(text.inputEl);
      });
  }
  protected handleSubmit(): Promise<boolean> {
    this.options.submit(this.value.trim() || null); return Promise.resolve(true);
  }
}
