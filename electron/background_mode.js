const fs = require("fs");

function isBackgroundMonitoringEnabled(config) {
  return config?.agent?.backgroundMonitoring === true;
}

function readBackgroundMonitoringConfig(configPath) {
  if (!configPath) return false;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return isBackgroundMonitoringEnabled(JSON.parse(raw));
  } catch {
    return false;
  }
}

function applyBackgroundMonitoringSettings({ appApi, enabled }) {
  appApi?.setLoginItemSettings?.({
    openAtLogin: enabled,
    openAsHidden: enabled,
  });
}

function shouldLaunchBackgroundOnly({
  enabled,
  wasOpenedAtLogin = false,
  wasOpenedAsHidden = false,
}) {
  return enabled && (wasOpenedAtLogin || wasOpenedAsHidden);
}

function getBackgroundQuitDialogOptions() {
  return {
    type: "question",
    buttons: ["Keep Running", "Quit"],
    defaultId: 0,
    cancelId: 0,
    message: "Keep runAlert running?",
    detail: "Quitting stops background monitoring until you open runAlert again.",
  };
}

module.exports = {
  isBackgroundMonitoringEnabled,
  readBackgroundMonitoringConfig,
  applyBackgroundMonitoringSettings,
  shouldLaunchBackgroundOnly,
  getBackgroundQuitDialogOptions,
};
