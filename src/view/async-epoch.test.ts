import { describe, expect, it } from "vitest";

import { AsyncEpoch } from "./async-epoch";

describe("AsyncEpoch", () => {
  it("invalidates older tokens after bumping", () => {
    const epoch = new AsyncEpoch();
    const oldToken = epoch.token();
    const currentToken = epoch.bump();

    expect(epoch.isCurrent(oldToken)).toBe(false);
    expect(epoch.isCurrent(currentToken)).toBe(true);
  });

  it("does not increment when reading the current token", () => {
    const epoch = new AsyncEpoch();
    const token = epoch.token();

    expect(epoch.token()).toEqual(token);
    expect(epoch.value).toBe(0);
  });

  it("tracks the value of the most recent bump", () => {
    const epoch = new AsyncEpoch();
    epoch.bump();
    const latest = epoch.bump();

    expect(epoch.value).toBe(latest.value);
    expect(epoch.value).toBe(2);
  });
});
