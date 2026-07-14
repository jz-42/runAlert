import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import updater from "../../electron/updater.js";

const { createMacUpdater } = updater;

describe("signed Mac updater", () => {
  it("checks the stable feed and exposes a restart prompt after download", async () => {
    const autoUpdater = new EventEmitter();
    autoUpdater.setFeedURL = vi.fn();
    autoUpdater.checkForUpdates = vi.fn(async () => {});
    autoUpdater.quitAndInstall = vi.fn();
    const onBeforeRestart = vi.fn();
    const states = [];
    const controller = createMacUpdater({
      autoUpdater,
      platform: "darwin",
      arch: "arm64",
      version: "1.0.0",
      isPackaged: true,
      enabled: true,
      onBeforeRestart,
      onState: (state) => states.push(state),
    });

    await controller.start();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: "https://update.electronjs.org/jz-42/runAlert/darwin-arm64/1.0.0",
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();

    autoUpdater.emit("update-downloaded", {}, "Release notes", "1.0.1");
    expect(controller.getState()).toMatchObject({
      status: "ready",
      version: "1.0.1",
      restartRequired: true,
    });
    controller.restart();
    expect(onBeforeRestart).toHaveBeenCalledOnce();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled();
    expect(states.at(-1).status).toBe("ready");
  });

  it("lets Microsoft Store and development builds own their update lifecycle", async () => {
    const autoUpdater = new EventEmitter();
    autoUpdater.checkForUpdates = vi.fn();
    const controller = createMacUpdater({
      autoUpdater,
      platform: "win32",
      isPackaged: true,
      enabled: true,
    });
    await controller.start();
    expect(controller.getState().status).toBe("store-managed");
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});
