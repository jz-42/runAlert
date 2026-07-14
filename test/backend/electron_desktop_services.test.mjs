import { describe, expect, it } from "vitest";

import desktopServices from "../../electron/desktop_services.js";

const { startDesktopServices } = desktopServices;

describe("electron/desktop_services", () => {
  it("starts local API before watcher and stops both", async () => {
    const calls = [];
    const apiServer = {
      close() {
        calls.push(["api.close"]);
      },
    };
    const watcher = {
      stop() {
        calls.push(["watcher.stop"]);
      },
    };

    const services = await startDesktopServices({
      userDataPath: "/tmp/runalert-user-data",
      bundledConfigPath: "/tmp/runalert/config.json",
      startLocalApi: async (options) => {
        calls.push(["api.start", options]);
        return {
          server: apiServer,
          url: "http://127.0.0.1:18787",
          configPath: "/tmp/runalert-user-data/config.json",
        };
      },
      startWatcher: (options) => {
        calls.push(["watcher.start", options]);
        return watcher;
      },
    });

    expect(services.apiUrl).toBe("http://127.0.0.1:18787");
    expect(calls[0]).toEqual([
      "api.start",
      {
        userDataPath: "/tmp/runalert-user-data",
        bundledConfigPath: "/tmp/runalert/config.json",
      },
    ]);
    expect(calls[1]).toEqual([
      "watcher.start",
      {
        userDataPath: "/tmp/runalert-user-data",
        configPath: "/tmp/runalert-user-data/config.json",
        notifyApiUrl: "http://127.0.0.1:18787/notify",
      },
    ]);

    services.stop();
    expect(calls.slice(2)).toEqual([["watcher.stop"], ["api.close"]]);
  });
});
