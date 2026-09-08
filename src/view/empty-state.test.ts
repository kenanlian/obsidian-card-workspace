import { describe, expect, it } from "vitest";

import { getUiStrings } from "../i18n";
import { resolveEmptyStateMessage } from "./empty-state";

const baseInput = {
  query: "",
  activeTagCount: 0,
  baseCardCount: 0,
  visibleCardCount: 0,
  propertyClauseCount: 0,
};

describe("resolveEmptyStateMessage", () => {
  it.each(["en", "zh"] as const)("defaults to the folder empty copy (%s)", (locale) => {
    const strings = getUiStrings(locale);
    expect(resolveEmptyStateMessage({ strings, ...baseInput })).toBe(strings.view.emptyFolder);
  });

  it.each(["en", "zh"] as const)("uses emptyBaseMessage for a links base-empty source (%s)", (locale) => {
    const strings = getUiStrings(locale);
    expect(resolveEmptyStateMessage({
      strings,
      ...baseInput,
      emptyBaseMessage: strings.links.emptyLinks,
    })).toBe(strings.links.emptyLinks);
  });

  it("keeps property-filter-empty precedence over a links base message", () => {
    const strings = getUiStrings("en");
    expect(resolveEmptyStateMessage({
      strings,
      ...baseInput,
      baseCardCount: 3,
      visibleCardCount: 0,
      propertyClauseCount: 1,
      emptyBaseMessage: strings.links.emptyLinks,
    })).toBe(strings.property.emptyPropertyFilter);
  });

  it("does not use the property-filter copy when the base source is empty", () => {
    const strings = getUiStrings("en");
    expect(resolveEmptyStateMessage({
      strings,
      ...baseInput,
      baseCardCount: 0,
      visibleCardCount: 0,
      propertyClauseCount: 1,
      emptyBaseMessage: strings.links.emptyLinks,
    })).toBe(strings.links.emptyLinks);
  });

  it("keeps query empty copy when a search is active", () => {
    const strings = getUiStrings("en");
    expect(resolveEmptyStateMessage({
      strings,
      ...baseInput,
      query: "needle",
      emptyBaseMessage: strings.links.emptyLinks,
    })).toBe(strings.view.emptySearchCurrentFolder("needle"));
  });
});
