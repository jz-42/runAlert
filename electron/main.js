const path = require("path");
const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  nativeImage,
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
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!launchBackgroundOnly) {
      mainWindow.show();
    }
    syncDockVisibility();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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

  const rendererUrl = isDev ? rendererDevUrl : apiUrl;
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
  const image = nativeImage.createEmpty();
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

app.whenReady().then(async () => {
  desktopServices = await startDesktopServices({
    userDataPath: app.getPath("userData"),
    bundledConfigPath: bundledConfigPath(),
  });
  apiUrl = desktopServices.apiUrl;
  configPath = desktopServices.configPath;
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
});

app.on("will-quit", () => {
  isQuitting = true;
});
