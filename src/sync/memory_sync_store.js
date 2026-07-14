function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createMemorySyncStore() {
  const accounts = new Map();
  const devices = new Map();
  const pairings = new Map();

  function findPairing(exchangeHash, codeHash) {
    return (
      Array.from(pairings.values()).find(
        (record) =>
          (exchangeHash && record.exchangeHash === exchangeHash) ||
          (codeHash && record.codeHash === codeHash)
      ) || null
    );
  }

  function pairingStatus(record, consumedAt) {
    if (!record) return "missing";
    if (record.consumedAt) return "consumed";
    if (new Date(record.expiresAt).getTime() <= new Date(consumedAt).getTime()) {
      return "expired";
    }
    return "consumed-now";
  }

  return {
    async healthCheck() {
      return true;
    },

    async bootstrapAccount({ accountId, envelope, device }) {
      accounts.set(accountId, clone(envelope));
      devices.set(device.credentialHash, clone(device));
    },

    async createAccount({ accountId, envelope }) {
      accounts.set(accountId, clone(envelope));
    },

    async createDevice(device) {
      devices.set(device.credentialHash, clone(device));
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
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        updatedAt,
        config: clone(config),
      };
      accounts.set(accountId, envelope);
      return { status: "updated", envelope: clone(envelope) };
    },

    async createPairingExchange(record) {
      pairings.set(record.pairingId, clone(record));
    },

    async consumePairingExchange({ exchangeHash, codeHash, now }) {
      const record = findPairing(exchangeHash, codeHash);
      const status = pairingStatus(record, now);
      if (status !== "consumed-now") return { status };
      record.consumedAt = now;
      return { status, exchange: clone(record) };
    },

    async completePairing({ exchangeHash, codeHash, now, device }) {
      const record = findPairing(exchangeHash, codeHash);
      const status = pairingStatus(record, now);
      if (status !== "consumed-now") {
        return {
          status,
          accountId: record?.accountId || null,
          requestedDeviceName: record?.requestedDeviceName || null,
        };
      }
      record.consumedAt = now;
      devices.set(device.credentialHash, {
        ...clone(device),
        accountId: record.accountId,
        revokedAt: null,
      });
      return {
        status,
        accountId: record.accountId,
        requestedDeviceName: record.requestedDeviceName,
      };
    },
  };
}

module.exports = { createMemorySyncStore };
