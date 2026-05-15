import { describe, expect, it, vi } from "vitest";

import electronNotification from "../../electron/electron_notification.js";

const { sendElectronDesktop } = electronNotification;

describe("electron/electron_notification", () => {
  it("shows notifications with app identity settings and opens URLs on click", async () => {
    const shown = [];
    const shell = { openExternal: vi.fn() };

    class FakeNotification {
      constructor(options) {
        this.options = options;
        this.handlers = {};
        shown.push(this);
      }

      on(event, handler) {
        this.handlers[event] = handler;
      }

      show() {
        this.wasShown = true;
      }
    }

    await sendElectronDesktop({
      title: "Bastion",
      message: "Run 123",
      openUrl: "https://twitch.tv/xqcow",
      sound: true,
      iconPath: "/tmp/runalert-icon.png",
      NotificationImpl: FakeNotification,
      shellImpl: shell,
    });

    expect(shown).toHaveLength(1);
    expect(shown[0].options).toMatchObject({
      title: "Bastion",
      body: "Run 123",
      silent: false,
      icon: "/tmp/runalert-icon.png",
      actions: [{ type: "button", text: "Open Stream" }],
      closeButtonText: "Dismiss",
    });
    expect(shown[0].wasShown).toBe(true);

    shown[0].handlers.click?.();
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://twitch.tv/xqcow"
    );

    shown[0].handlers.action?.(null, 0);
    expect(shell.openExternal).toHaveBeenCalledTimes(2);
  });
});
