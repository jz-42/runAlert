import { describe, expect, it, vi } from "vitest";

import backgroundMode from "../../electron/background_mode.js";

const {
  applyBackgroundMonitoringSettings,
  getBackgroundQuitDialogOptions,
  shouldLaunchBackgroundOnly,
} = backgroundMode;

describe("electron/background_mode", () => {
  it("applies login-item settings for background monitoring", () => {
    const appApi = {
      setLoginItemSettings: vi.fn(),
    };

    applyBackgroundMonitoringSettings({
      appApi,
      enabled: true,
    });

    expect(appApi.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
    });
  });

  it("shows a simple quit confirmation that explains the behavior loss", () => {
    expect(getBackgroundQuitDialogOptions()).toMatchObject({
      message: "Keep runAlert running?",
      detail:
        "Quitting stops background monitoring until you open runAlert again.",
      buttons: ["Keep Running", "Quit"],
    });
  });

  it("launches quietly only when background monitoring opened the app at login", () => {
    expect(
      shouldLaunchBackgroundOnly({
        enabled: true,
        wasOpenedAtLogin: true,
        wasOpenedAsHidden: false,
      })
    ).toBe(true);
    expect(
      shouldLaunchBackgroundOnly({
        enabled: true,
        wasOpenedAtLogin: false,
        wasOpenedAsHidden: false,
      })
    ).toBe(false);
  });
});
