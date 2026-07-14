const path = require("path");
const {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  shell,
} = require("electron");
const { DEFAULT_PORT } = require("./local_api");
const {
  applyBackgroundMonitoringSettings,
  getBackgroundQuitDialogOptions,
  readBackgroundMonitoringConfig,
  shouldLaunchBackgroundOnly,
} = require("./background_mode");
const { startDesktopServices } = require("./desktop_services");
const { createDesktopSyncService } = require("./desktop_sync");
const { findPairingDeepLink, parsePairingDeepLink } = require("./deep_links");
const {
  isAllowedExternalUrl,
  isAllowedRendererNavigation,
} = require("./navigation_policy");
const { createMacUpdater } = require("./updater");

const isDev =
  process.env.RUNALERT_ELECTRON_DEV === "1" || process.env.NODE_ENV === "development";
const rendererDevUrl =
  process.env.RUNALERT_RENDERER_URL || "http://127.0.0.1:5173";

let mainWindow = null;
let tray = null;
let desktopServices = null;
let apiUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
let isQuitting = false;
let configPath = null;
let backgroundMonitoringEnabled = false;
let launchBackgroundOnly = false;
let allowImmediateQuit = false;
let syncService = null;
let updater = null;
let pendingPairing = findPairingDeepLink(process.argv);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient("runalert", process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient("runalert");
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  const parsed = parsePairingDeepLink(url);
  if (parsed) void handlePairing(parsed);
});

app.on("second-instance", (_event, commandLine) => {
  const parsed = findPairingDeepLink(commandLine);
  if (parsed) void handlePairing(parsed);
  showMainWindow();
});

function bundledConfigPath() {
  return path.join(__dirname, "..", "config.json");
}

function syncDockVisibility() {
  if (process.platform !== "darwin" || !app.dock) return;
  const shouldHide =
    backgroundMonitoringEnabled && (!mainWindow || !mainWindow.isVisible());
  if (shouldHide) {
    app.dock.hide();
    return;
  }
  app.dock.show();
}

function syncBackgroundMonitoring() {
  applyBackgroundMonitoringSettings({
    appApi: app,
    enabled: backgroundMonitoringEnabled,
  });
  syncDockVisibility();
  if (tray) {
    tray.setToolTip(
      backgroundMonitoringEnabled
        ? "runAlert • Background Monitoring On"
        : "runAlert"
    );
  }
}

function refreshBackgroundMonitoringFromConfig() {
  const next = readBackgroundMonitoringConfig(configPath);
  if (next === backgroundMonitoringEnabled) return;
  backgroundMonitoringEnabled = next;
  syncBackgroundMonitoring();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "runAlert",
    backgroundColor: "#f6f5f1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: [`--runalert-api-base=${apiUrl}`],
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!launchBackgroundOnly) {
      mainWindow.show();
    }
    syncDockVisibility();
  });

  const rendererUrl = isDev ? rendererDevUrl : apiUrl;
  const rendererOrigin = new URL(rendererUrl).origin;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url, rendererOrigin)) {
      event.preventDefault();
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    syncDockVisibility();
  });

  mainWindow.on("show", () => {
    syncDockVisibility();
  });

  mainWindow.on("hide", () => {
    syncDockVisibility();
  });

  mainWindow.loadURL(rendererUrl);
}

function showMainWindow() {
  if (!mainWindow) {
    launchBackgroundOnly = false;
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  launchBackgroundOnly = false;
  syncDockVisibility();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const trayIconPath = path.join(
    __dirname,
    "..",
    "build",
    "icon.iconset",
    process.platform === "darwin" ? "icon_16x16.png" : "icon_32x32.png"
  );
  const image = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("runAlert");
  if (process.platform === "darwin") {
    tray.setTitle("runAlert");
  }

  const menu = Menu.buildFromTemplate([
    { label: "Open runAlert", click: showMainWindow },
    { type: "separator" },
    {
      label: "Background Monitoring",
      type: "checkbox",
      checked: backgroundMonitoringEnabled,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit runAlert",
      click: () => {
        allowImmediateQuit = false;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on("click", showMainWindow);
}

function readAutoUpdateEnabled() {
  try {
    const config = JSON.parse(require("fs").readFileSync(configPath, "utf8"));
    return config?.agent?.autoUpdate !== false;
  } catch {
    return true;
  }
}

async function handlePairing(payload) {
  if (!payload) return;
  if (!syncService) {
    pendingPairing = payload;
    return;
  }
  try {
    await syncService.pair({ ...payload, deviceName: `${process.platform} desktop` });
    pendingPairing = null;
    showMainWindow();
    mainWindow?.reload();
  } catch (error) {
    dialog.showErrorBox(
      "Could not pair runAlert",
      error?.message || "The pairing link may have expired. Create a new link and try again."
    );
  }
}

async function ipcResult(operation) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error?.serverEnvelope) {
      return { ok: false, conflict: true, serverEnvelope: error.serverEnvelope };
    }
    return { ok: false, message: error?.message || String(error) };
  }
}

function registerDesktopIpc() {
  ipcMain.handle("runalert:sync:is-paired", () => syncService?.isPaired() || false);
  ipcMain.handle("runalert:sync:pull", () => ipcResult(() => syncService.pull()));
  ipcMain.handle("runalert:sync:push", (_event, config) =>
    ipcResult(() => syncService.push(config))
  );
  ipcMain.handle("runalert:sync:pair", (_event, payload) =>
    ipcResult(() => syncService.pair(payload))
  );
  ipcMain.handle("runalert:updates:get-state", () => updater?.getState() || null);
  ipcMain.handle("runalert:updates:restart", () => updater?.restart() || false);
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  desktopServices = await startDesktopServices({
    userDataPath: app.getPath("userData"),
    bundledConfigPath: bundledConfigPath(),
  });
  apiUrl = desktopServices.apiUrl;
  configPath = desktopServices.configPath;
  syncService = createDesktopSyncService({
    userDataPath: app.getPath("userData"),
    configPath,
    safeStorage,
  });
  registerDesktopIpc();
  backgroundMonitoringEnabled = readBackgroundMonitoringConfig(configPath);
  const loginSettings = app.getLoginItemSettings();
  launchBackgroundOnly = shouldLaunchBackgroundOnly({
    enabled: backgroundMonitoringEnabled,
    wasOpenedAtLogin: loginSettings?.wasOpenedAtLogin,
    wasOpenedAsHidden: loginSettings?.wasOpenedAsHidden,
  });

  createTray();
  createMainWindow();
  syncBackgroundMonitoring();

  updater = createMacUpdater({
    autoUpdater,
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    enabled: readAutoUpdateEnabled(),
    onBeforeRestart: () => {
      allowImmediateQuit = true;
    },
    onState: async (state) => {
      mainWindow?.webContents.send("runalert:updates:state", state);
      if (state.status !== "ready") return;
      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: "info",
        buttons: ["Later", "Restart and update"],
        defaultId: 1,
        cancelId: 0,
        message: `runAlert ${state.version || "update"} is ready`,
        detail: "Restart runAlert to finish installing the signed update.",
      });
      if (result.response === 1) updater?.restart();
    },
  });
  void updater.start();

  if (pendingPairing) void handlePairing(pendingPairing);

  app.on("activate", showMainWindow);

  if (configPath) {
    require("fs").watchFile(configPath, { interval: 1000 }, () => {
      refreshBackgroundMonitoringFromConfig();
    });
  }
});

app.on("before-quit", async (event) => {
  if (allowImmediateQuit || isQuitting) {
    isQuitting = true;
    return;
  }
  if (!backgroundMonitoringEnabled) {
    isQuitting = true;
    return;
  }
  event.preventDefault();
  const result = await dialog.showMessageBox(
    mainWindow || undefined,
    getBackgroundQuitDialogOptions()
  );
  if (result.response === 1) {
    allowImmediateQuit = true;
    isQuitting = true;
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // Keep the app process alive so alerts can keep running while the window is closed.
});

app.on("quit", () => {
  if (configPath) {
    require("fs").unwatchFile(configPath);
  }
  if (desktopServices) {
    desktopServices.stop();
  }
  updater?.stop();
});

app.on("will-quit", () => {
  isQuitting = true;
});
