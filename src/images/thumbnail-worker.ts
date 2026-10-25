import type { RuntimeResourceBudget } from "../runtime/resource-budget";
import { generateThumbnail } from "./thumbnail-render";
import type { ThumbnailResult } from "./types";
// This entry runs in a dedicated Worker, where window is unavailable.
const workerScope = self as unknown as {
  onmessage: (event: MessageEvent<{ buffer: ArrayBuffer; budget: RuntimeResourceBudget["image"] }>) => void;
  postMessage: (value: ThumbnailResult | { status: "eligible" }) => void;
};

function postResult(result: ThumbnailResult | { status: "eligible" }): void {
  workerScope.postMessage(result);
}

workerScope.onmessage = (event) => {
  void generateThumbnail(event.data.buffer, () => postResult({ status: "eligible" }), event.data.budget)
    .then(postResult)
    .catch(() => postResult({ status: "failed" }));
};
