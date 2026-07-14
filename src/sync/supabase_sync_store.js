function parseJsonResponse(response) {
  return response.text().then((text) => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Supabase returned invalid JSON (${response.status})`);
    }
  });
}

function normalizeEnvelope(row) {
  if (!row) return null;
  return {
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    config: row.config,
  };
}

class SupabaseSyncStore {
  constructor({ url, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
    this.url = String(url || "").replace(/\/$/, "");
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.fetchImpl = fetchImpl;
    if (!this.url || !this.serviceRoleKey) {
      throw new Error("Supabase URL and service-role key are required");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch is required for Supabase sync storage");
    }
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${this.url}/rest/v1${path}`, {
      ...options,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        Accept: "application/json",
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await parseJsonResponse(response).catch(() => null);
      const detail = body?.message || body?.hint || `HTTP ${response.status}`;
      throw new Error(`Supabase sync request failed: ${detail}`);
    }
    return parseJsonResponse(response);
  }

  rpc(name, body) {
    return this.request(`/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async healthCheck() {
    await this.request("/runalert_v1_configs?select=account_id&limit=1", {
      method: "GET",
    });
    return true;
  }

  async bootstrapAccount({ accountId, envelope, device }) {
    await this.rpc("runalert_bootstrap_account", {
      p_account_id: accountId,
      p_schema_version: envelope.schemaVersion,
      p_revision: envelope.revision,
      p_updated_at: envelope.updatedAt,
      p_config: envelope.config,
      p_device_id: device.deviceId,
      p_credential_hash: device.credentialHash,
      p_device_name: device.deviceName,
      p_device_created_at: device.createdAt,
    });
  }

  async createAccount({ accountId, envelope }) {
    await this.request("/runalert_v1_configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        schema_version: envelope.schemaVersion,
        revision: envelope.revision,
        updated_at: envelope.updatedAt,
        config: envelope.config,
      }),
    });
  }

  async createDevice(record) {
    await this.request("/runalert_v1_device_credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: record.deviceId,
        account_id: record.accountId,
        credential_hash: record.credentialHash,
        device_name: record.deviceName,
        created_at: record.createdAt,
        revoked_at: record.revokedAt,
      }),
    });
  }

  async findDeviceByCredentialHash(credentialHash) {
    const rows = await this.request(
      `/runalert_v1_device_credentials?credential_hash=eq.${encodeURIComponent(
        credentialHash
      )}&select=id,account_id,device_name,created_at,revoked_at&limit=1`,
      { method: "GET" }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    return {
      deviceId: row.id,
      accountId: row.account_id,
      deviceName: row.device_name,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }

  async getConfig(accountId) {
    const rows = await this.request(
      `/runalert_v1_configs?account_id=eq.${encodeURIComponent(
        accountId
      )}&select=schema_version,revision,updated_at,config&limit=1`,
      { method: "GET" }
    );
    return normalizeEnvelope(Array.isArray(rows) ? rows[0] : null);
  }

  async updateConfig({ accountId, expectedRevision, config, updatedAt }) {
    const payload = await this.rpc("runalert_update_config", {
      p_account_id: accountId,
      p_expected_revision: expectedRevision,
      p_updated_at: updatedAt,
      p_config: config,
    });
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || row.update_status === "missing") return { status: "missing" };
    const envelope = normalizeEnvelope(row);
    return {
      status: row.update_status === "conflict" ? "conflict" : "updated",
      envelope,
    };
  }

  async createPairingExchange(record) {
    await this.request("/runalert_v1_pairing_exchanges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: record.pairingId,
        account_id: record.accountId,
        exchange_hash: record.exchangeHash,
        code_hash: record.codeHash,
        requested_device_name: record.requestedDeviceName,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        consumed_at: record.consumedAt,
      }),
    });
  }

  async consumePairingExchange({ exchangeHash, codeHash, now }) {
    const payload = await this.rpc("runalert_consume_pairing_exchange", {
      p_exchange_hash: exchangeHash,
      p_code_hash: codeHash,
      p_consumed_at: now,
    });
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row) return { status: "missing" };
    if (row.consume_status !== "consumed-now") {
      return { status: row.consume_status };
    }
    return {
      status: "consumed-now",
      exchange: {
        pairingId: row.pairing_id,
        accountId: row.account_id,
        requestedDeviceName: row.requested_device_name,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      },
    };
  }

  async completePairing({ exchangeHash, codeHash, now, device }) {
    const payload = await this.rpc("runalert_complete_pairing", {
      p_exchange_hash: exchangeHash,
      p_code_hash: codeHash,
      p_consumed_at: now,
      p_device_id: device.deviceId,
      p_credential_hash: device.credentialHash,
      p_device_name: device.deviceName,
      p_device_created_at: device.createdAt,
    });
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row) return { status: "missing" };
    return {
      status: row.consume_status,
      accountId: row.account_id || null,
      requestedDeviceName: row.requested_device_name || null,
    };
  }
}

function createSupabaseSyncStoreFromEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || "";
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  if (!url || !serviceRoleKey) return null;
  return new SupabaseSyncStore({ url, serviceRoleKey });
}

module.exports = {
  SupabaseSyncStore,
  createSupabaseSyncStoreFromEnv,
  normalizeEnvelope,
};
