const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { createDefaultConfig } = require("../config/default_config");
const { validateConfig } = require("../config/validate_config");

const PAIRING_TTL_MS = 10 * 60 * 1000;
const DEVICE_NAME_MAX = 80;
const MANUAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function secretHash(secret, pepper) {
  return crypto
    .createHmac("sha256", String(pepper || ""))
    .update(String(secret || ""))
    .digest("hex");
}

function createSecret(prefix = "") {
  return `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
}

function createManualCode() {
  const bytes = crypto.randomBytes(8);
  const characters = Array.from(bytes, (value) => {
    return MANUAL_CODE_ALPHABET[value % MANUAL_CODE_ALPHABET.length];
  }).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

function normalizeDeviceName(value, fallback = "Device") {
  const name = String(value || "").trim();
  if (!name) return fallback;
  return name.slice(0, DEVICE_NAME_MAX);
}

function parseBearer(req) {
  const header = String(req.get("authorization") || "").trim();
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match ? match[1] : null;
}

function etagForRevision(revision) {
  return `"${revision}"`;
}

function parseIfMatch(value) {
  const match = /^(?:W\/)?"(\d+)"$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

function createSyncEventBroker() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    emit(accountId, event) {
      emitter.emit(accountId, event);
    },
    subscribe(accountId, listener) {
      emitter.on(accountId, listener);
      return () => emitter.off(accountId, listener);
    },
  };
}

function sendStoreUnavailable(res) {
  return res.status(503).json({
    error: "sync_store_unavailable",
    message: "Synced settings are temporarily unavailable. Your local edits are safe.",
  });
}

function attachV1SyncApi(
  app,
  {
    syncStore,
    credentialPepper = process.env.RUNALERT_CREDENTIAL_PEPPER || "",
    requireCredentialPepper = false,
    now = () => new Date(),
    eventBroker = createSyncEventBroker(),
  } = {}
) {
  if (!syncStore) {
    if (requireCredentialPepper) {
      app.use(
        [
          "/api/devices",
          "/api/config",
          "/api/pairing-links",
          "/api/pair/exchange",
        ],
        (_req, res) =>
          res.status(503).json({
            error: "sync_not_configured",
            message: "Durable synced settings are not configured on this deployment.",
          })
      );
    }
    return {
      enabled: false,
      reason: "sync_store_not_configured",
      eventBroker,
    };
  }
  if (requireCredentialPepper && String(credentialPepper).length < 16) {
    app.use(
      [
        "/api/devices",
        "/api/config",
        "/api/pairing-links",
        "/api/pair/exchange",
      ],
      (_req, res) =>
        res.status(503).json({
          error: "sync_not_configured",
          message: "Synced settings are not configured on this deployment.",
        })
    );
    return {
      enabled: false,
      reason: "credential_pepper_not_configured",
      eventBroker,
    };
  }

  async function authenticate(req, res, next) {
    const credential = parseBearer(req);
    if (!credential || !credential.startsWith("ra1_")) {
      return res.status(401).json({ error: "invalid_device_credential" });
    }
    try {
      const device = await syncStore.findDeviceByCredentialHash(
        secretHash(credential, credentialPepper)
      );
      if (!device || device.revokedAt) {
        return res.status(401).json({ error: "invalid_device_credential" });
      }
      req.runAlertDevice = device;
      return next();
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  }

  app.post("/api/devices", async (req, res) => {
    const createdAt = now().toISOString();
    const accountId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const credential = createSecret("ra1_");
    const envelope = {
      schemaVersion: 1,
      revision: 1,
      updatedAt: createdAt,
      config: createDefaultConfig(),
    };
    try {
      const device = {
        deviceId,
        accountId,
        credentialHash: secretHash(credential, credentialPepper),
        deviceName: normalizeDeviceName(req.body?.deviceName, "Browser"),
        createdAt,
        revokedAt: null,
      };
      if (typeof syncStore.bootstrapAccount === "function") {
        await syncStore.bootstrapAccount({ accountId, envelope, device });
      } else {
        await syncStore.createAccount({ accountId, envelope });
        await syncStore.createDevice(device);
      }
      res.set("Cache-Control", "no-store");
      return res.status(201).json({ deviceId, credential, envelope });
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  });

  app.get("/api/config", authenticate, async (req, res) => {
    try {
      const envelope = await syncStore.getConfig(req.runAlertDevice.accountId);
      if (!envelope) return res.status(404).json({ error: "config_not_found" });
      res.set("ETag", etagForRevision(envelope.revision));
      res.set("Cache-Control", "private, no-cache");
      return res.json(envelope);
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  });

  app.put("/api/config", authenticate, async (req, res) => {
    const expectedRevision = Number(req.body?.expectedRevision);
    const ifMatchRevision = parseIfMatch(req.get("if-match"));
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1 ||
      ifMatchRevision == null ||
      ifMatchRevision !== expectedRevision
    ) {
      return res.status(428).json({
        error: "revision_precondition_required",
        message: "Send the current revision in both If-Match and expectedRevision.",
      });
    }

    const validation = validateConfig(req.body?.config);
    if (!validation.ok) {
      return res.status(400).json({
        error: "invalid_config",
        details: validation.errors,
      });
    }

    try {
      const result = await syncStore.updateConfig({
        accountId: req.runAlertDevice.accountId,
        expectedRevision,
        config: validation.value,
        updatedAt: now().toISOString(),
      });
      if (result.status === "missing") {
        return res.status(404).json({ error: "config_not_found" });
      }
      if (result.status === "conflict") {
        res.set("ETag", etagForRevision(result.envelope.revision));
        return res.status(409).json({
          error: "revision_conflict",
          envelope: result.envelope,
        });
      }
      res.set("ETag", etagForRevision(result.envelope.revision));
      eventBroker.emit(req.runAlertDevice.accountId, {
        type: "revision",
        revision: result.envelope.revision,
        updatedAt: result.envelope.updatedAt,
      });
      return res.json(result.envelope);
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  });

  app.get("/api/config/events", authenticate, async (req, res) => {
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let closed = false;
    const writeEvent = (event) => {
      if (closed) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    writeEvent({ type: "connected", retry: 3000 });
    const unsubscribe = eventBroker.subscribe(
      req.runAlertDevice.accountId,
      writeEvent
    );
    const heartbeat = setInterval(() => {
      if (!closed) res.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref?.();
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post("/api/pairing-links", authenticate, async (req, res) => {
    const exchange = createSecret();
    const code = createManualCode();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS).toISOString();
    const record = {
      pairingId: crypto.randomUUID(),
      accountId: req.runAlertDevice.accountId,
      exchangeHash: secretHash(exchange, credentialPepper),
      codeHash: secretHash(code.replace(/-/g, ""), credentialPepper),
      requestedDeviceName: normalizeDeviceName(req.body?.deviceName, "Paired device"),
      createdAt: createdAt.toISOString(),
      expiresAt,
      consumedAt: null,
    };
    try {
      await syncStore.createPairingExchange(record);
      res.set("Cache-Control", "no-store");
      return res.status(201).json({
        deepLink: `runalert://pair?exchange=${encodeURIComponent(exchange)}`,
        code,
        expiresAt,
      });
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  });

  app.post("/api/pair/exchange", async (req, res) => {
    const exchange = String(req.body?.exchange || "").trim();
    const code = String(req.body?.code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!exchange && !code) {
      return res.status(400).json({ error: "pairing_exchange_required" });
    }
    try {
      const exchangeHash = exchange
        ? secretHash(exchange, credentialPepper)
        : null;
      const codeHash = code ? secretHash(code, credentialPepper) : null;
      const credential = createSecret("ra1_");
      const deviceId = crypto.randomUUID();
      const createdAt = now().toISOString();
      const device = {
        deviceId,
        credentialHash: secretHash(credential, credentialPepper),
        deviceName: normalizeDeviceName(req.body?.deviceName, "Paired device"),
        createdAt,
      };
      const result =
        typeof syncStore.completePairing === "function"
          ? await syncStore.completePairing({
              exchangeHash,
              codeHash,
              now: createdAt,
              device,
            })
          : await syncStore.consumePairingExchange({
              exchangeHash,
              codeHash,
              now: createdAt,
            });
      if (result.status === "expired") {
        return res.status(410).json({ error: "pairing_exchange_expired" });
      }
      if (result.status === "consumed") {
        return res.status(410).json({ error: "pairing_exchange_consumed" });
      }
      if (result.status !== "consumed-now") {
        return res.status(404).json({ error: "pairing_exchange_not_found" });
      }
      const accountId = result.accountId || result.exchange?.accountId;
      if (!accountId) {
        return res.status(404).json({ error: "pairing_exchange_not_found" });
      }
      if (typeof syncStore.completePairing !== "function") {
        await syncStore.createDevice({
          ...device,
          accountId,
          deviceName: normalizeDeviceName(
            req.body?.deviceName,
            result.exchange.requestedDeviceName
          ),
          revokedAt: null,
        });
      }
      const envelope = await syncStore.getConfig(accountId);
      res.set("Cache-Control", "no-store");
      return res.status(201).json({ deviceId, credential, envelope });
    } catch (_error) {
      return sendStoreUnavailable(res);
    }
  });

  return { enabled: true, eventBroker, authenticate };
}

module.exports = {
  PAIRING_TTL_MS,
  attachV1SyncApi,
  createSyncEventBroker,
  etagForRevision,
  parseBearer,
  parseIfMatch,
  secretHash,
};
