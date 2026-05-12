/**
 * Auto-update execution flow tests
 *
 * These verify we run the expected git/npm/restart sequence when a newer
 * eligible tag exists for the current update channel.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import childProcess from "child_process";

import watcher from "../../src/watcher/run_watcher.js";

const { maybeAutoUpdateOnce } = watcher;

function toBuffer(s) {
  return Buffer.from(String(s), "utf8");
}

describe("watcher auto-update flow", () => {
  let existsSyncSpy;
  let execSyncSpy;

  beforeEach(() => {
    process.env.RUNALERT_AGENT_CHANNEL = "";
    vi.useFakeTimers();

    existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    execSyncSpy = vi.spyOn(childProcess, "execSync");
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.RUNALERT_AGENT_CHANNEL;
    existsSyncSpy.mockRestore();
    execSyncSpy.mockRestore();
  });

  it("runs checkout/install/restart sequence for newer stable tag", () => {
    execSyncSpy.mockImplementation((cmd) => {
      if (cmd === "git remote get-url origin") return toBuffer("origin\n");
      if (cmd === "git fetch --tags origin") return toBuffer("");
      if (cmd === "git tag --list")
        return toBuffer("v1.0.0\nv1.0.1-beta.1\nv1.0.1\n");
      if (cmd === "git describe --tags --exact-match") return toBuffer("v1.0.0\n");
      if (cmd === "git checkout --detach v1.0.1") return toBuffer("");
      if (cmd === "npm install --production") return toBuffer("");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined);

    maybeAutoUpdateOnce({ agent: { autoUpdate: true } });

    expect(execSyncSpy).toHaveBeenCalledWith("git fetch --tags origin", {
      stdio: "pipe",
    });
    expect(execSyncSpy).toHaveBeenCalledWith("git tag --list", {
      stdio: "pipe",
    });
    expect(execSyncSpy).toHaveBeenCalledWith("git describe --tags --exact-match", {
      stdio: "pipe",
    });
    expect(execSyncSpy).toHaveBeenCalledWith("git checkout --detach v1.0.1", {
      stdio: "pipe",
    });
    expect(execSyncSpy).toHaveBeenCalledWith("npm install --production", {
      stdio: "inherit",
    });

    vi.runAllTimers();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it("does not install or restart when already on latest eligible stable tag", () => {
    execSyncSpy.mockImplementation((cmd) => {
      if (cmd === "git remote get-url origin") return toBuffer("origin\n");
      if (cmd === "git fetch --tags origin") return toBuffer("");
      if (cmd === "git tag --list")
        return toBuffer("v1.0.0\nv1.0.1-beta.1\nv1.0.1\n");
      if (cmd === "git describe --tags --exact-match") return toBuffer("v1.0.1\n");
      if (cmd === "npm install --production") return toBuffer("");
      if (cmd.startsWith("git checkout --detach ")) return toBuffer("");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined);

    maybeAutoUpdateOnce({ agent: { autoUpdate: true } });
    vi.runAllTimers();

    expect(execSyncSpy).not.toHaveBeenCalledWith("npm install --production", {
      stdio: "inherit",
    });
    expect(
      execSyncSpy.mock.calls.some(
        ([cmd]) => String(cmd).startsWith("git checkout --detach ")
      )
    ).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
