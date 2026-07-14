const DEFAULT_UPDATE_BASE = "https://update.electronjs.org/jz-42/runAlert";

function createMacUpdater({
  autoUpdater,
  platform = process.platform,
  arch = process.arch,
  version,
  isPackaged,
  enabled,
  updateBaseUrl = DEFAULT_UPDATE_BASE,
  onBeforeRestart = () => {},
  onState = () => {},
  setIntervalImpl = setInterval,
} = {}) {
  let state = { status: "idle", restartRequired: false, version: null };
  let interval = null;

  function publish(next) {
    state = { ...state, ...next };
    onState({ ...state });
  }

  async function check() {
    if (platform !== "darwin" || !isPackaged || !enabled) return;
    publish({ status: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publish({ status: "error", message: error?.message || String(error) });
    }
  }

  async function start() {
    if (platform === "win32") {
      publish({ status: "store-managed" });
      return;
    }
    if (platform !== "darwin" || !isPackaged || !enabled) {
      publish({ status: "disabled" });
      return;
    }
    autoUpdater.setFeedURL({
      url: `${String(updateBaseUrl).replace(/\/$/, "")}/darwin-${arch}/${version}`,
    });
    autoUpdater.on("update-available", (_event, releaseNotes, releaseName) => {
      publish({ status: "downloading", version: releaseName || null, releaseNotes });
    });
    autoUpdater.on("update-not-available", () => {
      publish({ status: "current" });
    });
    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      publish({
        status: "ready",
        version: releaseName || null,
        releaseNotes,
        restartRequired: true,
      });
    });
    autoUpdater.on("error", (error) => {
      publish({ status: "error", message: error?.message || String(error) });
    });
    await check();
    interval = setIntervalImpl(check, 6 * 60 * 60 * 1000);
    interval?.unref?.();
  }

  function restart() {
    if (!state.restartRequired) return false;
    onBeforeRestart();
    autoUpdater.quitAndInstall();
    return true;
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  return {
    check,
    getState: () => ({ ...state }),
    restart,
    start,
    stop,
  };
}

module.exports = {
  DEFAULT_UPDATE_BASE,
  createMacUpdater,
};
