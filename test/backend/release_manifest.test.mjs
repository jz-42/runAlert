import { describe, expect, it } from "vitest";
import request from "supertest";

import server from "../../src/api/server.js";

const { createApp } = server;

describe("stable release manifest", () => {
  it("reports v1 platform destinations without beta hardcoding", async () => {
    const app = createApp({
      syncStore: null,
      releaseManifest: {
        version: "1.0.0",
        publishedAt: "2026-07-14T18:00:00.000Z",
        mac: {
          available: true,
          dmgUrl: "https://example.com/runAlert-1.0.0-universal.dmg",
          zipUrl: "https://example.com/runAlert-1.0.0-mac.zip",
          universal: true,
        },
        windows: {
          available: true,
          storeUrl: "https://apps.microsoft.com/detail/example",
        },
      },
    });

    const response = await request(app).get("/api/releases/stable");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("max-age=300");
    expect(response.body).toMatchObject({
      channel: "stable",
      version: "1.0.0",
      mac: { available: true, universal: true },
      windows: { available: true },
    });
    expect(JSON.stringify(response.body)).not.toContain("beta");
  });

  it("retires executable beta installer scripts", async () => {
    const app = createApp({ syncStore: null });
    await request(app).get("/install/macos.command").expect(410);
    await request(app).get("/install/windows.ps1").expect(410);
  });

  it("retires direct beta downloads in favor of the stable manifest", async () => {
    const app = createApp({ syncStore: null });
    await request(app).get("/download/macos/dmg").expect(410);
    await request(app).get("/download/macos/zip").expect(410);
    await request(app).get("/download/windows/exe").expect(410);
  });
});
