import { describe, expect, it } from "vitest";

import watcher from "../../src/watcher/run_watcher.js";

const { isRunLive } = watcher;

describe("watcher run liveness", () => {
  it("treats a live-runs match as live even when world.isLive is false", () => {
    const world = {
      isLive: false,
      data: {
        updateTime: 1_700_000_000,
      },
    };
    const liveRun = {
      nickname: "xQcOW",
      lastUpdated: 1_700_000_010_000,
    };

    expect(isRunLive(world, liveRun, 1_700_000_020)).toBe(true);
  });

  it("treats a recently updated run as live enough to keep watching", () => {
    const nowSec = 1_700_000_000;
    const world = {
      isLive: false,
      data: {
        updateTime: nowSec - 30,
      },
    };

    expect(isRunLive(world, null, nowSec)).toBe(true);
  });

  it("does not treat stale inactive runs as live", () => {
    const nowSec = 1_700_000_000;
    const world = {
      isLive: false,
      data: {
        updateTime: nowSec - 3_600,
      },
    };

    expect(isRunLive(world, null, nowSec)).toBe(false);
  });
});
