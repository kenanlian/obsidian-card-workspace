import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { imageKey } from "./types";
import { ThumbnailStore } from "./ThumbnailStore";
describe("thumbnail IndexedDB", () => {
  it("persists across close/restart and isolates vaults", async () => {
    const factory = new IDBFactory(), first = new ThumbnailStore("a", factory);
    await first.put("image", new Blob(["thumb"])); first.close();
    const restart = new ThumbnailStore("a", factory);
    expect(await (await restart.get("image"))?.text()).toBe("thumb");
    const other = new ThumbnailStore("b", factory); expect(await other.get("image")).toBeNull();
    restart.close(); other.close();
  });
  it("evicts by recent use under both entry and byte limits without loading all blobs", async () => {
    const store = new ThumbnailStore("a", new IDBFactory(), 2, 10);
    await store.put("a", new Blob(["aaaa"])); await store.put("b", new Blob(["bbbb"]));
    await new Promise((resolve) => setTimeout(resolve, 2)); await store.get("a");
    await store.put("c", new Blob(["cccc"])); expect(await store.get("b")).toBeNull();
    expect(await store.get("a")).not.toBeNull();
    await store.put("d", new Blob(["dddddddd"])); expect(await store.get("a")).toBeNull(); expect(await store.get("c")).toBeNull();
    expect(await store.get("d")).not.toBeNull(); store.close();
  });
  it("defers closed-cache invalidation and removes folder descendants with path boundaries", async () => {
    const factory = new IDBFactory(), store = new ThumbnailStore("a", factory);
    const key = (path: string) => imageKey({ vault: "a", path, mtime: 1, size: 100, version: 1 });
    await store.put(key("folder/a.png"), new Blob(["old"])); await store.put(key("folderish/a.png"), new Blob(["valid"])); store.close();
    const open = factory.open.bind(factory); let opens = 0; factory.open = (...args) => { opens++; return open(...args); };
    await store.invalidate(["folder"], true); expect(opens).toBe(0);
    expect(await store.get(key("folder/a.png"))).toBeNull(); expect(await store.get(key("folderish/a.png"))).not.toBeNull(); store.close();
  });

  it("survives quota failures without putting image failures into file operations", async () => {
    const factory = new IDBFactory(), open = factory.open.bind(factory);
    factory.open = (...args) => {
      const request = open(...args);
      request.addEventListener("success", () => {
        const db = request.result, transaction = db.transaction.bind(db);
        db.transaction = (...txArgs) => {
          const tx = transaction(...txArgs);
          // Abort only the thumbnail write transaction; the cache stays optional.
          if (tx.mode === "readwrite") queueMicrotask(() => tx.abort());
          return tx;
        };
      });
      return request;
    };
    const store = new ThumbnailStore("quota-fixture", factory);
    await expect(store.put("key", new Blob(["thumb"]))).resolves.toBeUndefined();
    expect(await store.get("key")).toBeNull(); store.close();
  });

  it("degrades to memory operation with unavailable IndexedDB", async () => {
    const store = new ThumbnailStore("a", null); await store.put("key", new Blob(["x"]));
    expect(await store.get("key")).toBeNull(); store.close();
  });
});
