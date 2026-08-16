import { describe, expect, it } from "vitest";

import { TagActions } from "./tag-actions";

describe("TagActions", () => {
  it("collapses duplicate and descendant removable tags", () => {
    const actions = new TagActions({ context: {} } as never);

    expect(actions.collapseBulkRemovableTags([
      "#project/alpha",
      "project",
      "project/alpha/deep",
      "status/open",
      "status/open",
    ])).toEqual(["project", "status/open"]);
  });
});
