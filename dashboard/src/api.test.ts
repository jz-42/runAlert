import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConfigConflictError,
  __resetApiTestState,
  createPairingLink,
  getConfig,
  getDeviceCredential,
  getProfiles,
  getReleaseManifest,
  getStatuses,
  getTwitchStatuses,
  getTwitchStatusBase,
  isDesktopApp,
  putConfig,
  putConfigRaw,
  subscribeConfigChanges,
  testNotify,
} from "./api";

const CONFIG = {
  streamers: [],
  clock: "IGT",
  quietHours: [],
  notifications: { enabled: true, sound: true },
  agent: { autoUpdate: true, backgroundMonitoring: false },
  channels: ["desktop"],
  defaultMilestones: {
    nether: { thresholdSec: 240, enabled: true },
    bastion: { thresholdSec: 360, enabled: true },
    fortress: { thresholdSec: 540, enabled: true },
    first_portal: { thresholdSec: 720, enabled: true },
    stronghold: { thresholdSec: 825, enabled: true },
    end: { thresholdSec: 840, enabled: true },
    finish: { thresholdSec: 900, enabled: true },
  },
  profiles: {},
};

const ENVELOPE = {
  schemaVersion: 1,
  revision: 1,
  updatedAt: "2026-07-14T18:00:00.000Z",
  config: CONFIG,
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    body: null,
  } as unknown as Response;
}

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

  it("bootstraps and stores a permanent browser device credential", async () => {
    const fetchMock = vi.fn(async () =>
      response(
        {
          deviceId: "device-1",
          credential: "ra1_browser-credential",
          envelope: ENVELOPE,
        },
        201
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(getConfig()).resolves.toEqual(CONFIG);
    await expect(getDeviceCredential()).resolves.toBe(
      "ra1_browser-credential"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/devices");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(window.localStorage.getItem("runalert-device-credential-v1")).toBe(
      "ra1_browser-credential"
    );
  });

  it("reuses a stored credential in Authorization and never reads URL tokens", async () => {
    window.history.replaceState({}, "", "/?token=legacy-secret");
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_stored-credential"
    );
    const fetchMock = vi.fn(async () => response(ENVELOPE, 200, { ETag: '"1"' }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(getConfig()).resolves.toEqual(CONFIG);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/config");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: "Bearer ra1_stored-credential" },
      })
    );
    expect(window.localStorage.getItem("runalert-token")).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("legacy-secret");
  });

  it("PUTs config with the bearer credential and current revision", async () => {
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_stored-credential"
    );
    const nextConfig = { ...CONFIG, streamers: ["Feinberg"] };
    const nextEnvelope = { ...ENVELOPE, revision: 2, config: nextConfig };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(ENVELOPE, 200, { ETag: '"1"' }))
      .mockResolvedValueOnce(response(nextEnvelope, 200, { ETag: '"2"' }));
    globalThis.fetch = fetchMock as typeof fetch;

    await getConfig();
    await expect(putConfigRaw(nextConfig)).resolves.toEqual(nextConfig);

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/config");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: "PUT",
      headers: {
        Authorization: "Bearer ra1_stored-credential",
        "Content-Type": "application/json",
        "If-Match": '"1"',
      },
      body: JSON.stringify({ expectedRevision: 1, config: nextConfig }),
    });
  });

  it("surfaces the server envelope on a revision conflict", async () => {
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_stored-credential"
    );
    const serverConfig = { ...CONFIG, streamers: ["Couriway"] };
    const serverEnvelope = { ...ENVELOPE, revision: 3, config: serverConfig };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(ENVELOPE, 200, { ETag: '"1"' }))
      .mockResolvedValueOnce(
        response(
          { error: "revision_conflict", envelope: serverEnvelope },
          409,
          { ETag: '"3"' }
        )
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await getConfig();
    const error = await putConfigRaw(CONFIG).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConfigConflictError);
    expect(error.serverEnvelope).toEqual(serverEnvelope);
    expect(error.serverValue).toEqual(serverConfig);
  });

  it("creates pairing links using bearer authorization", async () => {
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_stored-credential"
    );
    const pairing = {
      deepLink: "runalert://pair?exchange=temporary",
      code: "ABCD-EFGH",
      expiresAt: "2026-07-14T18:10:00.000Z",
    };
    const fetchMock = vi.fn(async () => response(pairing, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(createPairingLink("Mac")).resolves.toEqual(pairing);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/pairing-links");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: "POST",
      headers: {
        Authorization: "Bearer ra1_stored-credential",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceName: "Mac" }),
    });
  });

  it("authenticates sync events and delivers revision notifications", async () => {
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_stored-credential"
    );
    const encoded = new TextEncoder().encode(
      'event: revision\ndata: {"type":"revision","revision":2}\n\n'
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    }));
    globalThis.fetch = fetchMock as typeof fetch;
    const onRevision = vi.fn();

    const stop = subscribeConfigChanges(onRevision, {
      reconnectDelayMs: 60_000,
      pollIntervalMs: 60_000,
    });
    await vi.waitFor(() => expect(onRevision).toHaveBeenCalledWith(2, "event"));
    stop();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/config/events");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: "Bearer ra1_stored-credential" },
      })
    );
  });

  it("uses the shared local config endpoint in the desktop app", async () => {
    (window as any).runAlertDesktop = { platform: "darwin" };
    const fetchMock = vi.fn(async () =>
      response({ ok: true, config: { ...CONFIG, streamers: ["Feinberg"] } })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    expect(isDesktopApp()).toBe(true);
    const result = await putConfig({ ...CONFIG, streamers: ["Feinberg"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/config");
    expect(result).toEqual({ ...CONFIG, streamers: ["Feinberg"] });
    expect(window.localStorage.getItem("runalert-device-credential-v1")).toBeNull();
  });

  it("reads the stable release manifest", async () => {
    const manifest = {
      version: "1.0.0",
      mac: { available: true, dmgUrl: "/download/macos/dmg" },
      windows: { available: false, storeUrl: null },
    };
    globalThis.fetch = vi.fn(async () => response(manifest)) as typeof fetch;

    await expect(getReleaseManifest()).resolves.toEqual(manifest);
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

  it("uses the current site origin for browser twitch-status requests", async () => {
    const expectedBase = window.location.origin;
    const fetchMock = vi.fn(async () =>
      response({
        statuses: { BadGamer: { isTwitchLive: true, twitch: "Jay12310" } },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await getTwitchStatuses(["BadGamer"]);
    expect(String(fetchMock.mock.calls[0]?.[0] || "")).toBe(
      `${expectedBase}/twitch/status?names=BadGamer`
    );
    expect(result.statuses.BadGamer).toEqual({
      isTwitchLive: true,
      twitch: "Jay12310",
    });
  });

  it("dedupes names for profile and status requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const text = String(url);
      if (text.includes("/profiles?")) {
        expect(text).toContain("/profiles?names=xQcOW%2Cforsen");
        return response({ profiles: { xQcOW: { avatarUrl: "a" } } });
      }
      expect(text).toContain("/status?names=xQcOW%2Cforsen");
      return response({ statuses: { xQcOW: { isLive: true } } });
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
  });

  it("POSTs test notifications to the dashboard backend", async () => {
    const fetchMock = vi.fn(async () => response({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(testNotify("title", "message")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/notify/test");
  });
});
