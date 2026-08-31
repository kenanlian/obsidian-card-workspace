import { describe, expect, it } from "vitest";

import { getUiStrings, type UiLanguage } from "../i18n";
import { deriveRuleId, describeBoxRule, resolveRuleLabel } from "./box-rule-identity";
import type { Rule } from "./types";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    folder: "Notes",
    includeSubfolders: false,
    tags: [],
    id: "",
    name: "",
    ...overrides,
  };
}

const LANGUAGES: UiLanguage[] = ["en", "zh"];

describe("deriveRuleId", () => {
  it("is stable under tag reordering", () => {
    const first = deriveRuleId(makeRule({ tags: ["alpha", "beta", "gamma"] }));
    const second = deriveRuleId(makeRule({ tags: ["gamma", "alpha", "beta"] }));
    expect(first).toBe(second);
  });

  it("does not mutate the source tag array", () => {
    const tags = ["gamma", "alpha"];
    deriveRuleId(makeRule({ tags }));
    expect(tags).toEqual(["gamma", "alpha"]);
  });

  it("does not throw on an empty tag list", () => {
    expect(deriveRuleId(makeRule({ folder: "", tags: [] }))).toBe("r:|false|");
  });

  it("differs when the folder changes", () => {
    expect(deriveRuleId(makeRule({ folder: "Notes" }))).not.toBe(
      deriveRuleId(makeRule({ folder: "Archive" })),
    );
  });

  it("differs when includeSubfolders changes", () => {
    expect(deriveRuleId(makeRule({ includeSubfolders: false }))).not.toBe(
      deriveRuleId(makeRule({ includeSubfolders: true })),
    );
  });

  it("differs when the tag set changes", () => {
    expect(deriveRuleId(makeRule({ tags: ["alpha"] }))).not.toBe(
      deriveRuleId(makeRule({ tags: ["alpha", "beta"] })),
    );
  });

  it("ignores id and name", () => {
    expect(deriveRuleId(makeRule({ id: "stale", name: "Custom" }))).toBe(
      deriveRuleId(makeRule({ id: "", name: "" })),
    );
  });
});

describe("describeBoxRule", () => {
  for (const language of LANGUAGES) {
    it(`describes root, subfolder, and tagged rules (${language})`, () => {
      const strings = getUiStrings(language);
      const box = strings.box;

      expect(describeBoxRule(strings, makeRule({ folder: "" }))).toBe(box.ruleRootLabel);
      expect(describeBoxRule(strings, makeRule({ folder: "Notes/Daily" }))).toBe("Notes/Daily");
      expect(
        describeBoxRule(strings, makeRule({ folder: "Notes", includeSubfolders: true })),
      ).toBe(`Notes (${box.ruleSubfolderSuffix})`);
      expect(describeBoxRule(strings, makeRule({ tags: ["alpha", "beta"] }))).toBe(
        `Notes${box.ruleTagsSeparator}#alpha, #beta`,
      );
      expect(
        describeBoxRule(
          strings,
          makeRule({ folder: "", includeSubfolders: true, tags: ["alpha"] }),
        ),
      ).toBe(`${box.ruleRootLabel} (${box.ruleSubfolderSuffix})${box.ruleTagsSeparator}#alpha`);
    });
  }
});

describe("resolveRuleLabel", () => {
  for (const language of LANGUAGES) {
    it(`prefers a non-empty trimmed name (${language})`, () => {
      const strings = getUiStrings(language);
      expect(resolveRuleLabel(strings, makeRule({ name: "  Reading queue  " }))).toBe(
        "Reading queue",
      );
    });

    it(`falls back to the derived description for empty and whitespace-only names (${language})`, () => {
      const strings = getUiStrings(language);
      const rule = makeRule({ folder: "", includeSubfolders: true, tags: ["alpha"] });
      const derived = describeBoxRule(strings, rule);

      expect(resolveRuleLabel(strings, { ...rule, name: "" })).toBe(derived);
      expect(resolveRuleLabel(strings, { ...rule, name: "   " })).toBe(derived);
    });
  }

  it("resolves different labels per language when falling back", () => {
    const rule = makeRule({ folder: "" });
    expect(resolveRuleLabel(getUiStrings("en"), rule)).toBe(getUiStrings("en").box.ruleRootLabel);
    expect(resolveRuleLabel(getUiStrings("zh"), rule)).toBe(getUiStrings("zh").box.ruleRootLabel);
  });
});
