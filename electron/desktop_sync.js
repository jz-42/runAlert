const fs = require("fs");
const path = require("path");

class DesktopConfigConflictError extends Error {
  constructor(serverEnvelope) {
    super("Synced settings changed on another device.");
    this.name = "DesktopConfigConflictError";
    this.serverEnvelope = serverEnvelope;
    this.serverValue = serverEnvelope.config;
  }
}

function isEnvelope(value) {
  return (
    value &&
    value.schemaVersion === 1 &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    typeof value.updatedAt === "string" &&
    value.config &&
    typeof value.config === "object"
  );
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode,
  });
  fs.renameSync(temporaryPath, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Windows ACLs are managed by the app container.
  }
}

function createDesktopSyncService({
  userDataPath,
  configPath,
  safeStorage,
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.RUNALERT_SYNC_BASE_URL || "https://runalert.app",
} = {}) {
  if (!userDataPath || !configPath) {
    throw new Error("userDataPath and configPath are required");
  }
  if (!safeStorage) throw new Error("safeStorage is required");
  fs.mkdirSync(userDataPath, { recursive: true });

  const credentialPath = path.join(userDataPath, "device-credential.enc");
  const statePath = path.join(userDataPath, "sync-state.json");

  function storeCredential(credential) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
    const encrypted = safeStorage.encryptString(String(credential));
    fs.writeFileSync(credentialPath, encrypted.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      fs.chmodSync(credentialPath, 0o600);
    } catch {
      // Windows ACLs are managed by the app container.
    }
  }

  function readCredential() {
    if (!fs.existsSync(credentialPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
    const encrypted = Buffer.from(fs.readFileSync(credentialPath, "utf8"), "base64");
    const credential = safeStorage.decryptString(encrypted);
    return String(credential || "").startsWith("ra1_") ? credential : null;
  }

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      return null;
    }
  }

  function writeEnvelope(envelope, { writeConfig = true } = {}) {
    if (!isEnvelope(envelope)) throw new Error("Sync returned an invalid config envelope.");
    writeJsonAtomic(
      statePath,
      { revision: envelope.revision, updatedAt: envelope.updatedAt },
      0o600
    );
    if (writeConfig) writeJsonAtomic(configPath, envelope.config, 0o600);
    return envelope.config;
  }

  async function jsonRequest(pathname, options = {}) {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}${pathname}`, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  async function pair({ exchange, code, deviceName = "Desktop app" } = {}) {
    const payload = { deviceName };
    if (exchange) payload.exchange = String(exchange);
    if (code) payload.code = String(code);
    const { response, body } = await jsonRequest("/api/pair/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`POST /api/pair/exchange ${response.status}`);
    if (!String(body?.credential || "").startsWith("ra1_") || !isEnvelope(body?.envelope)) {
      throw new Error("Pairing returned an invalid response.");
    }
    storeCredential(body.credential);
    writeEnvelope(body.envelope);
    return { paired: true, envelope: body.envelope };
  }

  async function pull() {
    const credential = readCredential();
    if (!credential) return { paired: false };
    const { response, body } = await jsonRequest("/api/config", {
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (!response.ok) throw new Error(`GET /api/config ${response.status}`);
    writeEnvelope(body);
    return { paired: true, envelope: body, config: body.config };
  }

  async function push(config) {
    const credential = readCredential();
    if (!credential) return { paired: false, config };
    let state = readState();
    if (!Number.isInteger(state?.revision)) {
      await pull();
      state = readState();
    }
    const expectedRevision = state.revision;
    const { response, body } = await jsonRequest("/api/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "If-Match": `"${expectedRevision}"`,
      },
      body: JSON.stringify({ expectedRevision, config }),
    });
    if (response.status === 409 && isEnvelope(body?.envelope)) {
      writeEnvelope(body.envelope, { writeConfig: false });
      throw new DesktopConfigConflictError(body.envelope);
    }
    if (!response.ok) throw new Error(`PUT /api/config ${response.status}`);
    writeEnvelope(body);
    return { paired: true, envelope: body, config: body.config };
  }

  return {
    credentialPath,
    statePath,
    isPaired: () => Boolean(readCredential()),
    pair,
    pull,
    push,
    readCredential,
    storeCredential,
  };
}

module.exports = {
  DesktopConfigConflictError,
  createDesktopSyncService,
  isEnvelope,
};
