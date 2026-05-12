import { describe, expect, it } from "vitest";

import watcher from "../../src/watcher/run_watcher.js";

const { getNotificationPrefs } = watcher;

describe("watcher notification prefs", () => {
  it("defaults desktop notifications to enabled with sound", () => {
    expect(getNotificationPrefs({})).toEqual({
      enabled: true,
      sound: true,
    });
  });

  it("respects disabled notifications and muted sound", () => {
    expect(
      getNotificationPrefs({
        notifications: {
          enabled: false,
          sound: false,
        },
      })
    ).toEqual({
      enabled: false,
      sound: false,
    });
  });
});
