import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("notify/router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.RUNALERT_NOTIFY_API_URL;
  });

  afterEach(() => {
    delete process.env.RUNALERT_NOTIFY_API_URL;
  });

  it("forwards desktop notifications to the local bridge when configured", async () => {
    process.env.RUNALERT_NOTIFY_API_URL = "http://127.0.0.1:18787/notify";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    const routerModule = await import("../../src/notify/router.js");
    const router = routerModule.default || routerModule;
    await router.send({
      channel: "desktop",
      title: "Bastion",
      message: "Run 123",
      openUrl: "https://twitch.tv/xqcow",
      sound: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18787/notify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "desktop",
          title: "Bastion",
          message: "Run 123",
          openUrl: "https://twitch.tv/xqcow",
          sound: true,
        }),
      })
    );
  });
});
