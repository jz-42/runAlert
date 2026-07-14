import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import server from "../../src/api/server.js";

const { createApp } = server;

function createLocalApp(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "runalert-security-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      streamers: [],
      clock: "IGT",
      quietHours: [],
      notifications: { enabled: true, sound: true },
      agent: { autoUpdate: true, backgroundMonitoring: false },
      channels: ["desktop"],
      defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
      profiles: {},
    })
  );
  return createApp({
    configPath,
    configDir: path.join(tempDir, "configs"),
    notifySend: vi.fn(async () => {}),
    paceman: {},
    ...options,
  });
}

describe("API production security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets browser security and privacy headers", async () => {
    const response = await request(createLocalApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'"
    );
  });

  it("rejects JSON bodies larger than 64 KiB", async () => {
    const response = await request(createLocalApp())
      .post("/notify/test")
      .send({ message: "x".repeat(70 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe("request_too_large");
  });

  it("rate limits repeated write requests and returns retry guidance", async () => {
    const app = createLocalApp({
      rateLimit: { windowMs: 60_000, max: 2 },
      clientAddress: () => "198.51.100.10",
    });

    expect((await request(app).post("/notify/test").send({})).status).toBe(200);
    expect((await request(app).post("/notify/test").send({})).status).toBe(200);
    const limited = await request(app).post("/notify/test").send({});

    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("rate_limit_exceeded");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("logs route paths without query strings, credentials, or streamer names", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const app = createLocalApp({ logger });

    await request(app)
      .get("/status?names=PrivateStreamer&token=permanent-secret")
      .set("x-request-id", "caller-controlled-secret");

    expect(logger.info).toHaveBeenCalled();
    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).toContain('"path","/status"');
    expect(serialized).not.toContain("PrivateStreamer");
    expect(serialized).not.toContain("permanent-secret");
    expect(serialized).not.toContain("caller-controlled-secret");
    expect(serialized).not.toContain("?names=");
  });
});
