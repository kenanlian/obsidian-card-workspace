import { generateThumbnail } from "./thumbnail-render";
import type { ThumbnailResult } from "./types";
// This entry runs in a dedicated Worker, where window is unavailable.
const workerScope = self as unknown as {
  onmessage: (event: MessageEvent<ArrayBuffer>) => void;
  postMessage: (value: ThumbnailResult | { status: "eligible" }) => void;
};

function postResult(result: ThumbnailResult | { status: "eligible" }): void {
  workerScope.postMessage(result);
}

workerScope.onmessage = (event) => {
  void generateThumbnail(event.data, () => postResult({ status: "eligible" }))
    .then(postResult)
    .catch(() => postResult({ status: "failed" }));
};
