import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import server from "../../src/api/server.js";

const { createApp } = server;

function tmpConfigPath() {
  return path.join(
    os.tmpdir(),
    `runalert-config-${Date.now()}-${Math.random()}.json`
  );
}

function seedConfig(targetPath, configDir) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    targetPath,
    JSON.stringify(
      {
        streamers: ["xQcOW"],
        clock: "IGT",
        quietHours: [],
        defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
        profiles: {},
      },
      null,
      2
    )
  );
}

describe("api/server extra contracts", () => {
  let configPath;
  let configDir;

  beforeEach(() => {
    vi.restoreAllMocks();
    configPath = tmpConfigPath();
    configDir = path.join(
      os.tmpdir(),
      `runalert-configs-${Date.now()}-${Math.random()}`
    );
    seedConfig(configPath, configDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.fetch;
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
  });

  it("sanitizes token values before creating per-user config files", async () => {
    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman: {},
    });

    const res = await request(app).get("/config?token=..%2Fbad%3C%3Etoken");

    expect(res.status).toBe(200);
    expect(fs.readdirSync(configDir)).toEqual(["badtoken.json"]);
  });

  it("rejects invalid quietHours payloads on PUT /config", async () => {
    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman: {},
    });

    const res = await request(app).put("/config").send({
      streamers: ["xQcOW"],
      defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
      quietHours: [{ start: "21:00", end: "09:00" }],
    });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || "")).toContain("quietHours must be");
  });

  it("derives sorted unique milestone bases from world keys", async () => {
    const paceman = {
      getRecentRunId: vi.fn().mockResolvedValue(321),
      getWorld: vi.fn().mockResolvedValue({
        data: {
          nether: 111_000,
          bastionRta: 222_000,
          firstPortal: 333_000,
          firstPortalRta: 334_000,
          insertTime: 123,
          updateTime: 456,
        },
      }),
    };
    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const res = await request(app).get("/paceman/milestones?name=xQcOW");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      runId: 321,
      milestones: ["bastion", "firstPortal", "nether"],
    });
  });

  it("caches profile lookups so repeated polls do not re-hit paceman", async () => {
    const paceman = {
      getRecentRunId: vi.fn().mockResolvedValue(123),
      getWorld: vi.fn().mockResolvedValue({
        data: {
          twitch: "https://www.twitch.tv/xQcOW?ref=runalert",
          uuid: "37ee4401-5b10-48f1-bdd3-05037bef612f",
        },
      }),
    };
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("decapi.me/twitch/avatar/xQcOW");
      return {
        ok: true,
        status: 200,
        text: async () => "https://cdn.example/avatar.png",
      };
    });

    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const first = await request(app).get("/profiles?names=xQcOW");
    const second = await request(app).get("/profiles?names=xQcOW");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.profiles.xQcOW.avatarUrl).toBe(
      "https://cdn.example/avatar.png"
    );
    expect(second.body.profiles.xQcOW.avatarUrl).toBe(
      "https://cdn.example/avatar.png"
    );
    expect(paceman.getRecentRunId).toHaveBeenCalledTimes(1);
    expect(paceman.getWorld).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses live-run data to mark a streamer live and fill missing splits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));
    const nowSec = Math.floor(Date.now() / 1000);

    const paceman = {
      getRecentRuns: vi.fn().mockResolvedValue([{ id: 444 }]),
      getWorld: vi.fn().mockResolvedValue({
        isLive: false,
        data: {
          twitch: "xQcOW",
          updateTime: nowSec - 3_600,
          insertTime: nowSec - 4_000,
          nether: null,
        },
      }),
      getLiveRuns: vi.fn().mockResolvedValue([
        {
          nickname: "xQcOW",
          lastUpdated: (nowSec - 10) * 1000,
          eventList: [{ eventId: "rsg.enter_nether", igt: 111_000, rta: 112_500 }],
        },
      ]),
    };
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("decapi.me/twitch/stream/xQcOW");
      return {
        ok: true,
        status: 200,
        text: async () => "offline",
      };
    });

    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const res = await request(app).get("/status?names=xQcOW");

    expect(res.status).toBe(200);
    expect(res.body.statuses.xQcOW).toMatchObject({
      isLive: true,
      isActive: true,
      runIsActive: true,
      isTwitchLive: false,
      lastUpdatedSec: nowSec - 10,
      lastMilestone: "nether",
      lastMilestoneSource: "live",
    });
    expect(res.body.statuses.xQcOW.splits.nether).toEqual({
      igt: 111_000,
      rta: 112_500,
    });
  });

  it("still reports twitch live state when paceman run lookups fail", async () => {
    const paceman = {
      getRecentRuns: vi.fn().mockRejectedValue(new Error("paceman down")),
      getWorld: vi.fn(),
      getLiveRuns: vi.fn().mockResolvedValue([]),
    };
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("decapi.me/twitch/stream/xQcOW");
      return {
        ok: true,
        status: 200,
        text: async () => "LIVE",
      };
    });

    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const res = await request(app).get("/status?names=xQcOW");

    expect(res.status).toBe(200);
    expect(res.body.statuses.xQcOW).toMatchObject({
      runId: null,
      isLive: false,
      isTwitchLive: true,
    });
  });

  it("falls back to Twitch preview detection when decapi is unavailable", async () => {
    const paceman = {
      getRecentRuns: vi.fn().mockResolvedValue([{ id: 444 }]),
      getWorld: vi.fn().mockResolvedValue({
        isLive: false,
        data: {
          twitch: "xQcOW",
          updateTime: 1,
          insertTime: 1,
        },
      }),
      getLiveRuns: vi.fn().mockResolvedValue([]),
    };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "404 Page Not Found",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        text: async () => "",
      });

    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const res = await request(app).get("/status?names=xQcOW");

    expect(res.status).toBe(200);
    expect(res.body.statuses.xQcOW).toMatchObject({
      isTwitchLive: true,
      twitch: "xQcOW",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("decapi.me/twitch/stream/xQcOW"),
      expect.anything()
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("live_user_xqcow-320x180.jpg"),
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("GET /twitch/status returns Helix-backed live booleans per handle", async () => {
    process.env.TWITCH_CLIENT_ID = "client";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ user_login: "xqc" }] }),
      });

    const paceman = {
      getRecentRunId: vi.fn(),
      getRecentRuns: vi.fn(),
      getWorld: vi.fn(),
      getLiveRuns: vi.fn(),
    };
    const app = createApp({
      configPath,
      configDir,
      notifySend: vi.fn(async () => {}),
      paceman,
    });

    const res = await request(app).get("/twitch/status?names=xqc");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      statuses: {
        xqc: {
          isTwitchLive: true,
          twitch: "xqc",
        },
      },
    });
    expect(paceman.getRecentRunId).not.toHaveBeenCalled();
    expect(paceman.getRecentRuns).not.toHaveBeenCalled();
    expect(paceman.getWorld).not.toHaveBeenCalled();
    expect(paceman.getLiveRuns).not.toHaveBeenCalled();
  });
});
