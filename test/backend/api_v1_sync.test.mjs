import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import server from "../../src/api/server.js";

const { createApp } = server;

const EMPTY_CONFIG = {
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

function clone(value) {
  return structuredClone(value);
}

function createTestSyncStore() {
  const accounts = new Map();
  const devices = new Map();
  const exchanges = new Map();

  return {
    accounts,
    devices,
    exchanges,
    async healthCheck() {
      return true;
    },
    async createAccount({ accountId, envelope }) {
      accounts.set(accountId, clone(envelope));
    },
    async createDevice(record) {
      devices.set(record.credentialHash, clone(record));
    },
    async findDeviceByCredentialHash(credentialHash) {
      return clone(devices.get(credentialHash) || null);
    },
    async getConfig(accountId) {
      return clone(accounts.get(accountId) || null);
    },
    async updateConfig({ accountId, expectedRevision, config, updatedAt }) {
      const current = accounts.get(accountId);
      if (!current) return { status: "missing" };
      if (current.revision !== expectedRevision) {
        return { status: "conflict", envelope: clone(current) };
      }
      const envelope = {
        schemaVersion: 1,
        revision: current.revision + 1,
        updatedAt,
        config: clone(config),
      };
      accounts.set(accountId, envelope);
      return { status: "updated", envelope: clone(envelope) };
    },
    async createPairingExchange(record) {
      exchanges.set(record.exchangeHash, clone(record));
    },
    async consumePairingExchange({ exchangeHash, codeHash, now }) {
      const record = exchangeHash
        ? exchanges.get(exchangeHash)
        : Array.from(exchanges.values()).find((item) => item.codeHash === codeHash);
      if (!record) return { status: "missing" };
      if (record.consumedAt) return { status: "consumed" };
      if (new Date(record.expiresAt).getTime() <= new Date(now).getTime()) {
        return { status: "expired" };
      }
      record.consumedAt = now;
      exchanges.set(record.exchangeHash, record);
      return { status: "consumed-now", exchange: clone(record) };
    },
  };
}

function auth(credential) {
  return { Authorization: `Bearer ${credential}` };
}

describe("v1 anonymous sync API", () => {
  let syncStore;
  let nowMs;
  let app;

  beforeEach(() => {
    syncStore = createTestSyncStore();
    nowMs = Date.parse("2026-07-14T18:00:00.000Z");
    app = createApp({
      syncStore,
      now: () => new Date(nowMs),
      credentialPepper: "test-pepper",
      notifySend: vi.fn(async () => {}),
      paceman: {},
    });
  });

  async function bootstrap(deviceName = "Browser") {
    return request(app).post("/api/devices").send({ deviceName });
  }

  it("creates a clean anonymous account and stores only a credential hash", async () => {
    const response = await bootstrap();

    expect(response.status).toBe(201);
    expect(response.body.credential).toMatch(/^ra1_[A-Za-z0-9_-]{32,}$/);
    expect(response.body.envelope).toEqual({
      schemaVersion: 1,
      revision: 1,
      updatedAt: "2026-07-14T18:00:00.000Z",
      config: EMPTY_CONFIG,
    });
    expect(response.body.envelope.config.streamers).toEqual([]);

    const storedDevices = Array.from(syncStore.devices.entries());
    expect(storedDevices).toHaveLength(1);
    expect(storedDevices[0][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(storedDevices[0][0]).not.toContain(response.body.credential);
    expect(JSON.stringify(storedDevices[0][1])).not.toContain(
      response.body.credential
    );
  });

  it("requires a bearer device credential and returns an ETag", async () => {
    const created = await bootstrap();

    const missing = await request(app).get("/api/config");
    expect(missing.status).toBe(401);

    const invalid = await request(app)
      .get("/api/config")
      .set(auth("ra1_invalid"));
    expect(invalid.status).toBe(401);

    const loaded = await request(app)
      .get("/api/config")
      .set(auth(created.body.credential));
    expect(loaded.status).toBe(200);
    expect(loaded.headers.etag).toBe('"1"');
    expect(loaded.body).toEqual(created.body.envelope);
  });

  it("uses conditional revisions and returns the server version on conflicts", async () => {
    const created = await bootstrap();
    const credential = created.body.credential;
    const nextConfig = {
      ...EMPTY_CONFIG,
      streamers: ["Feinberg"],
      profiles: { Feinberg: {} },
    };

    const updated = await request(app)
      .put("/api/config")
      .set(auth(credential))
      .set("If-Match", '"1"')
      .send({ expectedRevision: 1, config: nextConfig });

    expect(updated.status).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      config: nextConfig,
    });

    const stale = await request(app)
      .put("/api/config")
      .set(auth(credential))
      .set("If-Match", '"1"')
      .send({ expectedRevision: 1, config: EMPTY_CONFIG });

    expect(stale.status).toBe(409);
    expect(stale.headers.etag).toBe('"2"');
    expect(stale.body).toEqual({
      error: "revision_conflict",
      envelope: updated.body,
    });
  });

  it("rejects legacy quiet-hour strings in the v1 schema", async () => {
    const created = await bootstrap();
    const invalid = {
      ...EMPTY_CONFIG,
      quietHours: "22:00-07:00",
    };

    const response = await request(app)
      .put("/api/config")
      .set(auth(created.body.credential))
      .set("If-Match", '"1"')
      .send({ expectedRevision: 1, config: invalid });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_config");
    expect(response.body.details).toContain("quietHours must be an array");
  });

  it("requires every canonical default milestone in v1 configs", async () => {
    const created = await bootstrap();
    const invalid = {
      ...EMPTY_CONFIG,
      defaultMilestones: {
        nether: { thresholdSec: 240, enabled: true },
      },
    };

    const response = await request(app)
      .put("/api/config")
      .set(auth(created.body.credential))
      .set("If-Match", '"1"')
      .send({ expectedRevision: 1, config: invalid });

    expect(response.status).toBe(400);
    expect(response.body.details.join(" ")).toContain(
      "defaultMilestones must define every supported milestone"
    );
  });

  it("creates a short-lived deep link and exchanges it exactly once", async () => {
    const created = await bootstrap("Safari");

    const pairing = await request(app)
      .post("/api/pairing-links")
      .set(auth(created.body.credential))
      .send({ deviceName: "Mac" });

    expect(pairing.status).toBe(201);
    expect(pairing.body.deepLink).toMatch(
      /^runalert:\/\/pair\?exchange=[A-Za-z0-9_-]+$/
    );
    expect(pairing.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(Date.parse(pairing.body.expiresAt) - nowMs).toBe(10 * 60 * 1000);
    expect(pairing.body.deepLink).not.toContain(created.body.credential);

    const exchangeSecret = new URL(pairing.body.deepLink).searchParams.get(
      "exchange"
    );
    const storedExchange = Array.from(syncStore.exchanges.values())[0];
    expect(storedExchange.exchangeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedExchange.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(storedExchange)).not.toContain(exchangeSecret);
    expect(JSON.stringify(storedExchange)).not.toContain(pairing.body.code);

    const exchanged = await request(app).post("/api/pair/exchange").send({
      exchange: exchangeSecret,
      deviceName: "MacBook",
    });
    expect(exchanged.status).toBe(201);
    expect(exchanged.body.credential).toMatch(/^ra1_/);
    expect(exchanged.body.envelope).toEqual(created.body.envelope);

    const replay = await request(app).post("/api/pair/exchange").send({
      exchange: exchangeSecret,
      deviceName: "Replay",
    });
    expect(replay.status).toBe(410);
    expect(replay.body.error).toBe("pairing_exchange_consumed");
  });

  it("supports manual pairing codes and rejects expired exchanges", async () => {
    const created = await bootstrap();
    const pairing = await request(app)
      .post("/api/pairing-links")
      .set(auth(created.body.credential))
      .send({});

    const manual = await request(app).post("/api/pair/exchange").send({
      code: pairing.body.code.toLowerCase(),
      deviceName: "Windows PC",
    });
    expect(manual.status).toBe(201);

    const anotherPairing = await request(app)
      .post("/api/pairing-links")
      .set(auth(created.body.credential))
      .send({});
    const exchangeSecret = new URL(
      anotherPairing.body.deepLink
    ).searchParams.get("exchange");

    nowMs += 10 * 60 * 1000 + 1;
    const expired = await request(app).post("/api/pair/exchange").send({
      exchange: exchangeSecret,
      deviceName: "Late device",
    });
    expect(expired.status).toBe(410);
    expect(expired.body.error).toBe("pairing_exchange_expired");
  });

  it("fails sync operations visibly when permanent storage is unavailable", async () => {
    const outage = new Error("supabase unavailable");
    const brokenStore = createTestSyncStore();
    brokenStore.findDeviceByCredentialHash = vi.fn(async () => {
      throw outage;
    });
    brokenStore.healthCheck = vi.fn(async () => {
      throw outage;
    });
    const brokenApp = createApp({
      syncStore: brokenStore,
      credentialPepper: "test-pepper",
      notifySend: vi.fn(async () => {}),
      paceman: {},
    });

    const configResponse = await request(brokenApp)
      .get("/api/config")
      .set(auth(`ra1_${crypto.randomBytes(32).toString("base64url")}`));
    expect(configResponse.status).toBe(503);
    expect(configResponse.body.error).toBe("sync_store_unavailable");

    const readiness = await request(brokenApp).get("/ready");
    expect(readiness.status).toBe(503);
    expect(readiness.body).toMatchObject({ ok: false, syncStore: "unavailable" });
  });
});

describe("production Supabase sync store wiring", () => {
  it("uses an isolated in-memory sync store for local development", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.NODE_ENV = "development";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const localApp = createApp({
        credentialPepper: "local-development-pepper",
        logger: null,
        notifySend: vi.fn(async () => {}),
        paceman: {},
      });
      const bootstrap = await request(localApp)
        .post("/api/devices")
        .send({ deviceName: "Local browser" });

      expect(bootstrap.status).toBe(201);
      expect(bootstrap.body.credential).toMatch(/^ra1_/);
      await request(localApp)
        .get("/api/config")
        .set(auth(bootstrap.body.credential))
        .expect(200);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("returns explicit 503 responses when the durable sync store is absent", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const logger = { info: vi.fn() };
      const productionApp = createApp({
        syncStore: null,
        credentialPepper: "production-pepper",
        logger,
        notifySend: vi.fn(async () => {}),
        paceman: {},
      });

      for (const path of [
        "/api/devices",
        "/api/config",
        "/api/config/events",
        "/api/pairing-links",
        "/api/pair/exchange",
      ]) {
        const response = await request(productionApp).post(path).send({});
        expect(response.status, path).toBe(503);
        expect(response.body.error, path).toBe("sync_not_configured");
      }
      expect(JSON.stringify(logger.info.mock.calls)).toContain(
        '"path","/api/devices"'
      );
    } finally {
      if (previousNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("fails readiness and sync bootstrap when the credential pepper is missing", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      RUNALERT_CREDENTIAL_PEPPER: process.env.RUNALERT_CREDENTIAL_PEPPER,
    };
    process.env.NODE_ENV = "production";
    delete process.env.RUNALERT_CREDENTIAL_PEPPER;

    try {
      const store = createTestSyncStore();
      const productionApp = createApp({
        syncStore: store,
        credentialPepper: "",
        logger: null,
        notifySend: vi.fn(async () => {}),
        paceman: {},
      });
      const readiness = await request(productionApp).get("/ready");
      expect(readiness.status).toBe(503);
      expect(readiness.body).toMatchObject({
        ok: false,
        syncStore: "credential_pepper_not_configured",
      });
      const bootstrap = await request(productionApp)
        .post("/api/devices")
        .send({ deviceName: "Browser" });
      expect(bootstrap.status).toBe(503);
      expect(bootstrap.body.error).toBe("sync_not_configured");
      expect(store.devices.size).toBe(0);
    } finally {
      if (previous.NODE_ENV == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.NODE_ENV;
      if (previous.RUNALERT_CREDENTIAL_PEPPER == null) {
        delete process.env.RUNALERT_CREDENTIAL_PEPPER;
      } else {
        process.env.RUNALERT_CREDENTIAL_PEPPER =
          previous.RUNALERT_CREDENTIAL_PEPPER;
      }
    }
  });

  it("bootstraps through the permanent store without sending raw credentials", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      RUNALERT_CREDENTIAL_PEPPER: process.env.RUNALERT_CREDENTIAL_PEPPER,
    };
    process.env.NODE_ENV = "production";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.RUNALERT_CREDENTIAL_PEPPER = "production-pepper";

    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/rest/v1/rpc/runalert_bootstrap_account")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({}),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const app = createApp({
        now: () => new Date("2026-07-14T18:00:00.000Z"),
        notifySend: vi.fn(async () => {}),
        paceman: {},
      });
      const response = await request(app)
        .post("/api/devices")
        .send({ deviceName: "Production browser" });

      expect(response.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://project.supabase.co/rest/v1/rpc/runalert_bootstrap_account"
      );
      expect(calls[0].options.headers).toMatchObject({
        apikey: "service-role",
        Authorization: "Bearer service-role",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(String(calls[0].options.body));
      expect(body.p_credential_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(body)).not.toContain(response.body.credential);
      expect(body.p_config.streamers).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
