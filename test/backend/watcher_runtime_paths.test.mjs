import path from "node:path";
import { describe, expect, it } from "vitest";

import watcher from "../../src/watcher/run_watcher.js";
import dedupeStore from "../../src/store/dedupe_store.js";

const { resolveConfigPath, shouldStartApi } = watcher;
const { resolveSentKeysPath } = dedupeStore;

describe("watcher runtime paths", () => {
  it("allows Electron to override config path while preserving the default", () => {
    expect(
      resolveConfigPath({
        RUNALERT_CONFIG_PATH: "/tmp/runalert/config.json",
      })
    ).toBe("/tmp/runalert/config.json");

    expect(resolveConfigPath({})).toBe(
      path.join(process.cwd(), "src/watcher/../../config.json")
    );
  });

  it("allows Electron to override dedupe storage path while preserving the default", () => {
    expect(
      resolveSentKeysPath({
        RUNALERT_SENT_KEYS_PATH: "/tmp/runalert/sent_keys.json",
      })
    ).toBe("/tmp/runalert/sent_keys.json");

    expect(resolveSentKeysPath({})).toBe(
      path.join(process.cwd(), "src/store/../../sent_keys.json")
    );
  });

  it("can suppress the watcher's standalone API server inside Electron", () => {
    expect(shouldStartApi({ RUNALERT_SKIP_API: "1" })).toBe(false);
    expect(shouldStartApi({})).toBe(true);
  });
});
