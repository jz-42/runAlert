const childProcess = require("child_process");
const path = require("path");

function resolveSentKeysPath(userDataPath) {
  if (!userDataPath) {
    throw new Error("userDataPath is required");
  }
  return path.join(userDataPath, "sent_keys.json");
}

function splitAsarPath(baseDir) {
  const marker = `${path.sep}app.asar`;
  const index = baseDir.indexOf(marker);
  if (index === -1) return null;
  const asarPath = baseDir.slice(0, index + marker.length);
  return {
    asarPath,
    resourcesPath: path.dirname(asarPath),
  };
}

function watcherScriptPath(baseDir = __dirname) {
  const packaged = splitAsarPath(baseDir);
  if (packaged) {
    return path.join(packaged.asarPath, "src", "watcher", "run_watcher.js");
  }
  return path.join(baseDir, "..", "src", "watcher", "run_watcher.js");
}

function resolveAppRootPath(baseDir = __dirname) {
  const packaged = splitAsarPath(baseDir);
  if (packaged) {
    return packaged.resourcesPath;
  }
  return path.join(baseDir, "..");
}

function resolveNotificationIconPath(baseDir = __dirname) {
  const packaged = splitAsarPath(baseDir);
  if (packaged) {
    return path.join(packaged.resourcesPath, "icon.icns");
  }
  return path.join(baseDir, "..", "dashboard", "public", "icon-1024.png");
}

function startWatcher({
  userDataPath,
  configPath,
  notifyApiUrl = "http://127.0.0.1:18787/notify",
  spawn = childProcess.spawn,
  logger = console,
  restartMinMs = 1000,
  restartMaxMs = 30_000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (!configPath) {
    throw new Error("configPath is required");
  }

  const sentKeysPath = resolveSentKeysPath(userDataPath);
  let child = null;
  let stopRequested = false;
  let restartTimer = null;
  let restartDelayMs = restartMinMs;

  function spawnWatcher() {
    if (stopRequested) return;
    child = spawn(process.execPath, [watcherScriptPath()], {
      cwd: resolveAppRootPath(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        RUNALERT_CONFIG_PATH: configPath,
        RUNALERT_SENT_KEYS_PATH: sentKeysPath,
        RUNALERT_SKIP_API: "1",
        RUNALERT_DESKTOP_APP: "1",
        RUNALERT_NOTIFY_API_URL: notifyApiUrl,
        RUNALERT_NOTIFICATION_ICON: resolveNotificationIconPath(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      logger.log(`[watcher] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on("data", (chunk) => {
      logger.warn(`[watcher] ${String(chunk).trimEnd()}`);
    });
    child.on?.("error", (error) => {
      logger.error("[watcher] failed to start", error);
    });
    child.on?.("exit", (code, signal) => {
      logger.log(
        `[watcher] exited code=${code ?? "null"} signal=${signal ?? "null"}`
      );
      if (stopRequested) return;
      const delay = restartDelayMs;
      restartDelayMs = Math.min(restartDelayMs * 2, restartMaxMs);
      logger.warn(`[watcher] restarting in ${delay}ms`);
      restartTimer = setTimeoutImpl(() => {
        restartTimer = null;
        spawnWatcher();
      }, delay);
    });
  }

  spawnWatcher();

  return {
    get process() {
      return child;
    },
    sentKeysPath,
    stop() {
      stopRequested = true;
      if (restartTimer) {
        clearTimeoutImpl(restartTimer);
        restartTimer = null;
      }
      if (child && !child.killed) {
        child.kill();
      }
    },
  };
}

module.exports = {
  resolveSentKeysPath,
  resolveAppRootPath,
  resolveNotificationIconPath,
  startWatcher,
  watcherScriptPath,
};
