import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import client from "../../src/paceman/client.js";

const {
  getRecentRunId,
  getRecentRuns,
  getRecentTimestamps,
  getLiveRuns,
  __resetLiveRunsCacheForTests,
} = client;

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe("paceman/client network contracts", () => {
  beforeEach(() => {
    __resetLiveRunsCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.fetch;
  });

  it("encodes streamer names and returns the first recent run id", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toContain("name=xQc%20OW");
      expect(String(url)).toContain("limit=3");
      return jsonResponse([{ id: 123 }, { id: 122 }]);
    });
    globalThis.fetch = fetchMock;

    await expect(getRecentRunId("xQc OW", 3)).resolves.toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 404s as empty recent runs and throws on other failures", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([], { ok: false, status: 404 }))
      .mockResolvedValueOnce(jsonResponse([], { ok: false, status: 500 }));

    await expect(getRecentRuns("missing")).resolves.toEqual([]);
    await expect(getRecentRuns("broken")).rejects.toThrow("getRecentRuns 500");
  });

  it("clamps recent timestamp limits and forwards onlyFort", async () => {
    const fetchMock = vi.fn(async (url) => {
      const text = String(url);
      expect(text).toContain("limit=50");
      expect(text).toContain("onlyFort=true");
      return jsonResponse([{ enter_nether: 123 }]);
    });
    globalThis.fetch = fetchMock;

    await expect(getRecentTimestamps("xQcOW", 999, true)).resolves.toEqual([
      { enter_nether: 123 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches live runs for the TTL and refreshes after it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }]));
    globalThis.fetch = fetchMock;

    await expect(getLiveRuns()).resolves.toEqual([{ id: 1 }]);
    await expect(getLiveRuns()).resolves.toEqual([{ id: 1 }]);

    vi.advanceTimersByTime(2_001);

    await expect(getLiveRuns()).resolves.toEqual([{ id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
