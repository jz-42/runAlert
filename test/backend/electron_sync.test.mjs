import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import desktopSync from "../../electron/desktop_sync.js";

const { createDesktopSyncService } = desktopSync;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function fixture() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "runalert-sync-"));
  const configPath = path.join(userDataPath, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ streamers: [] }));
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value) =>
      value.toString().replace(/^encrypted:/, "")
    ),
  };
  return { userDataPath, configPath, safeStorage };
}

describe("encrypted desktop config sync", () => {
  it("exchanges a pairing secret, stores only encrypted credentials, and writes config", async () => {
    const f = fixture();
    const envelope = {
      schemaVersion: 1,
      revision: 4,
      updatedAt: "2026-07-14T18:00:00.000Z",
      config: { streamers: ["Feinberg"] },
    };
    const fetchImpl = vi.fn(async () =>
      response(201, { credential: "ra1_permanent-secret", envelope })
    );
    const service = createDesktopSyncService({ ...f, fetchImpl });

    await service.pair({ exchange: "temporary-exchange", deviceName: "Mac" });

    const credentialFile = fs.readFileSync(
      path.join(f.userDataPath, "device-credential.enc"),
      "utf8"
    );
    expect(credentialFile).not.toContain("ra1_permanent-secret");
    expect(f.safeStorage.encryptString).toHaveBeenCalledWith("ra1_permanent-secret");
    expect(JSON.parse(fs.readFileSync(f.configPath, "utf8"))).toEqual(
      envelope.config
    );
    expect(fetchImpl.mock.calls[0][1].body).not.toContain("ra1_permanent-secret");
  });

  it("uses bearer auth and revision preconditions without exposing credentials", async () => {
    const f = fixture();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(201, {
          credential: "ra1_permanent-secret",
          envelope: {
            schemaVersion: 1,
            revision: 2,
            updatedAt: "2026-07-14T18:00:00.000Z",
            config: { streamers: [] },
          },
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          schemaVersion: 1,
          revision: 3,
          updatedAt: "2026-07-14T18:01:00.000Z",
          config: { streamers: ["Couriway"] },
        })
      );
    const service = createDesktopSyncService({ ...f, fetchImpl });
    await service.pair({ code: "ABCD-EFGH", deviceName: "Windows" });

    const config = { streamers: ["Couriway"] };
    await service.push(config);
    const [, requestOptions] = fetchImpl.mock.calls[1];
    expect(requestOptions.headers.Authorization).toBe("Bearer ra1_permanent-secret");
    expect(requestOptions.headers["If-Match"]).toBe('"2"');
    expect(JSON.parse(requestOptions.body)).toEqual({
      expectedRevision: 2,
      config,
    });
  });

  it("surfaces server conflicts for an explicit user choice", async () => {
    const f = fixture();
    const serverEnvelope = {
      schemaVersion: 1,
      revision: 8,
      updatedAt: "2026-07-14T18:01:00.000Z",
      config: { streamers: ["Server"] },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(201, {
          credential: "ra1_permanent-secret",
          envelope: { ...serverEnvelope, revision: 7, config: { streamers: [] } },
        })
      )
      .mockResolvedValueOnce(
        response(409, { error: "revision_conflict", envelope: serverEnvelope })
      );
    const service = createDesktopSyncService({ ...f, fetchImpl });
    await service.pair({ exchange: "once", deviceName: "Mac" });

    await expect(service.push({ streamers: ["Local"] })).rejects.toMatchObject({
      name: "DesktopConfigConflictError",
      serverValue: serverEnvelope.config,
    });
  });

  it("refuses plaintext fallback when OS encryption is unavailable", () => {
    const f = fixture();
    f.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    const service = createDesktopSyncService({ ...f, fetchImpl: vi.fn() });
    expect(() => service.storeCredential("ra1_secret")).toThrow(
      /secure credential storage is unavailable/i
    );
  });
});
