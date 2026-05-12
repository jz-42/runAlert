const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
} = require("electron");
const { DEFAULT_PORT } = require("./local_api");
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

function bundledConfigPath() {
  return path.join(__dirname, "..", "config.json");
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
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  const rendererUrl = isDev ? rendererDevUrl : apiUrl;
  mainWindow.loadURL(rendererUrl);
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
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
      label: "Keep running after window close",
      type: "checkbox",
      checked: true,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit runAlert",
      click: () => {
        isQuitting = true;
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

  createTray();
  createMainWindow();

  app.on("activate", showMainWindow);
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep the app process alive so alerts can keep running while the window is closed.
});

app.on("quit", () => {
  if (desktopServices) {
    desktopServices.stop();
  }
});
