import { describe, expect, it, vi } from "vitest";
import { createStreamPanelModel, type StreamPanelState } from "./stream-panel-model";
import { getStreamUiStrings } from "./stream-ui-strings";
describe("stream panel bridge", () => {
  it("immediately subscribes, publishes complete host snapshots and unsubscribes", () => {
    const initial: StreamPanelState = { layout: null, entries: [], currentStreamId: null, maximizedStreamId: null, navigationVisible: true, singlePane: false, navPanelModel: null, navProps: {}, labels: getStreamUiStrings("en"), recentlyClosedCount: 0, unsupported: false };
    const model = createStreamPanelModel(initial), listener = vi.fn(); const stop = model.subscribe(listener);
    expect(listener).toHaveBeenLastCalledWith(initial); const next = { ...initial, maximizedStreamId: "a" }; model.setState(next); expect(model.getState()).toBe(next); expect(listener).toHaveBeenLastCalledWith(next);
    stop(); model.setState(initial); expect(listener).toHaveBeenCalledTimes(2);
  });
  it("localizes every visible stream label and defaults unknown languages to English", () => {
    const en = getStreamUiStrings("en"), zh = getStreamUiStrings("zh-CN"); expect(getStreamUiStrings("fr")).toBe(en);
    for (const key of Object.keys(en) as (keyof typeof en)[]) { expect(zh[key]).toBeTruthy(); expect(zh[key]).not.toBe(en[key]); }
  });
});
