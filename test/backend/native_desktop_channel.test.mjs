import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import desktopChannel from "../../src/notify/desktop_channel.js";

const { sendDesktop } = desktopChannel;

describe("legacy-free native notification fallback", () => {
  it("passes Mac notification content as arguments without shell interpolation", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const promise = sendDesktop("Title $(touch /tmp/bad)", "Message `id`", {
      platform: "darwin",
      spawn,
    });
    child.emit("close", 0);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe("osascript");
    expect(args.at(-2)).toBe("Title $(touch /tmp/bad)");
    expect(args.at(-1)).toBe("Message `id`");
    expect(options.shell).toBe(false);
  });
});
