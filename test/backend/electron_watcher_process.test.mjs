import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it } from "vitest";

import watcherProcess from "../../electron/watcher_process.js";

const {
  startWatcher,
  resolveSentKeysPath,
  resolveAppRootPath,
  watcherScriptPath,
} = watcherProcess;

function fakeSpawnRecorder() {
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  const spawn = (...args) => {
    calls.push(args);
    return child;
  };

  return { calls, child, spawn };
}

describe("electron/watcher_process", () => {
  it("starts watcher with local config, local dedupe path, and no duplicate API server", () => {
    const recorder = fakeSpawnRecorder();
    const userDataPath = "/tmp/runalert-user-data";
    const configPath = "/tmp/runalert-user-data/config.json";

    const handle = startWatcher({
      userDataPath,
      configPath,
      spawn: recorder.spawn,
      logger: { log() {}, warn() {}, error() {} },
    });

    expect(recorder.calls).toHaveLength(1);
    const [command, args, options] = recorder.calls[0];

    expect(command).toBe(process.execPath);
    expect(args).toEqual([path.join(process.cwd(), "src/watcher/run_watcher.js")]);
    expect(options.cwd).toBe(process.cwd());
    expect(options.env.RUNALERT_CONFIG_PATH).toBe(configPath);
    expect(options.env.RUNALERT_SENT_KEYS_PATH).toBe(
      path.join(userDataPath, "sent_keys.json")
    );
    expect(options.env.RUNALERT_SKIP_API).toBe("1");
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.env.RUNALERT_NOTIFY_API_URL).toBe(
      "http://127.0.0.1:18787/notify"
    );
    expect(options.env.RUNALERT_NOTIFICATION_ICON).toBe(
      path.join(process.cwd(), "dashboard", "public", "icon-1024.png")
    );

    handle.stop();
    expect(recorder.child.killed).toBe(true);
  });

  it("resolves sent keys into Electron user data", () => {
    expect(resolveSentKeysPath("/tmp/runalert-user-data")).toBe(
      "/tmp/runalert-user-data/sent_keys.json"
    );
  });

  it("uses a real directory as cwd when packaged inside app.asar", () => {
    const packagedDir =
      "/Applications/runAlert.app/Contents/Resources/app.asar/electron";

    expect(watcherScriptPath(packagedDir)).toBe(
      "/Applications/runAlert.app/Contents/Resources/app.asar/src/watcher/run_watcher.js"
    );
    expect(resolveAppRootPath(packagedDir)).toBe(
      "/Applications/runAlert.app/Contents/Resources"
    );
  });
});
