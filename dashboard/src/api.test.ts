import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetApiTestState,
  getTwitchStatusBase,
  getProfiles,
  getStatuses,
  getToken,
  isDesktopApp,
  putConfig,
  testNotify,
} from "./api";

describe("dashboard api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetApiTestState();
    window.localStorage.clear();
    delete (window as any).runAlertDesktop;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers a token from the URL and persists it", () => {
    window.history.replaceState({}, "", "/?token=url-token");

    expect(getToken()).toBe("url-token");
    expect(window.localStorage.getItem("runalert-token")).toBe("url-token");
  });

  it("reuses a stored token before generating a new one", () => {
    window.localStorage.setItem("runalert-token", "stored-token");

    expect(getToken()).toBe("stored-token");
  });

  it("generates and caches a token when none is present", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      (typedArray) => {
        for (let i = 0; i < typedArray.length; i += 1) {
          typedArray[i] = i;
        }
        return typedArray;
      }
    );

    const first = getToken();
    const second = getToken();

    expect(first).toBe("000102030405060708090a0b0c0d0e0f");
    expect(second).toBe(first);
    expect(window.localStorage.getItem("runalert-token")).toBe(first);
  });

  it("uses the shared local config endpoint in the desktop app", async () => {
    (window as any).runAlertDesktop = { platform: "darwin" };
    window.localStorage.setItem("runalert-token", "browser-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ streamers: ["xQcOW", "Feinberg"] }),
      });
    globalThis.fetch = fetchMock as typeof fetch;

    expect(isDesktopApp()).toBe(true);
    expect(getToken()).toBe("");

    const result = await putConfig({ streamers: ["xQcOW", "Feinberg"] });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/config");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/config");
    expect(result).toEqual({ streamers: ["xQcOW", "Feinberg"] });
  });

  it("defaults desktop twitch status to the hosted app when no base is provided", () => {
    (window as any).runAlertDesktop = { platform: "darwin" };

    expect(getTwitchStatusBase()).toBe("https://runalert.app");
  });

  it("keeps desktop twitch status local during electron dev", () => {
    (window as any).runAlertDesktop = { platform: "darwin" };
    vi.stubEnv("RUNALERT_ELECTRON_DEV", "1");

    expect(getTwitchStatusBase()).toBe("");
  });

  it("PUTs config to the tokenized endpoint and re-fetches canonical config", async () => {
    window.localStorage.setItem("runalert-token", "abc123");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ streamers: ["xQcOW"] }),
      });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await putConfig({ streamers: ["xQcOW"] });

    expect(String(fetchMock.mock.calls[0]?.[0] || "")).toContain(
      "/config?token=abc123"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamers: ["xQcOW"] }),
      })
    );
    expect(String(fetchMock.mock.calls[1]?.[0] || "")).toContain(
      "/config?token=abc123"
    );
    expect(result).toEqual({ streamers: ["xQcOW"] });
  });

  it("dedupes names for profile and status requests and short-circuits empty input", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const text = String(url);
      if (text.includes("/profiles?")) {
        expect(text).toContain("/profiles?names=xQcOW%2Cforsen");
        return {
          ok: true,
          status: 200,
          json: async () => ({ profiles: { xQcOW: { avatarUrl: "a" } } }),
        };
      }
      expect(text).toContain("/status?names=xQcOW%2Cforsen");
      return {
        ok: true,
        status: 200,
        json: async () => ({ statuses: { xQcOW: { isLive: true } } }),
      };
    });
    globalThis.fetch = fetchMock as typeof fetch;

    expect(await getProfiles(["xQcOW", " xQcOW ", "", "forsen"])).toEqual({
      ok: true,
      profiles: { xQcOW: { avatarUrl: "a" } },
    });
    expect(await getStatuses(["xQcOW", "forsen", "xQcOW"])).toEqual({
      ok: true,
      statuses: { xQcOW: { isLive: true } },
    });
    expect(await getStatuses([])).toEqual({ ok: true, statuses: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POSTs test notifications to the dashboard backend", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(testNotify("title", "message")).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0] || "")).toContain("/notify/test");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "title", message: "message" }),
      })
    );
  });
});
