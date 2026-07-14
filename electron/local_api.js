const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = 0;

function ensureLocalConfig({ userDataPath, bundledConfigPath }) {
  if (!userDataPath) {
    throw new Error("userDataPath is required");
  }
  if (!bundledConfigPath) {
    throw new Error("bundledConfigPath is required");
  }

  fs.mkdirSync(userDataPath, { recursive: true });

  const configPath = path.join(userDataPath, "config.json");

  if (!fs.existsSync(configPath)) {
    fs.copyFileSync(bundledConfigPath, configPath);
  }

  return { configPath };
}

function startLocalApi({
  userDataPath,
  bundledConfigPath,
  port = DEFAULT_PORT,
  logger = console,
} = {}) {
  const { createApp } = require("../src/api/server");
  const {
    sendElectronDesktop,
    resolveNotificationIconPath,
  } = require("./electron_notification");
  const { configPath } = ensureLocalConfig({
    userDataPath,
    bundledConfigPath,
  });

  const apiApp = createApp({
    configPath,
    desktopNotifyBridge: true,
    notifySend: async ({ title, message, openUrl, sound }) =>
      sendElectronDesktop({
        title,
        message,
        openUrl,
        sound,
        iconPath: resolveNotificationIconPath(),
      }),
  });

  return new Promise((resolve, reject) => {
    const server = apiApp.listen(port, "127.0.0.1");

    server.once("listening", () => {
      const address = server.address();
      const resolvedPort =
        address && typeof address === "object" ? address.port : port;
      const url = `http://127.0.0.1:${resolvedPort}`;
      logger.log(`[electron] local API listening on ${url}`);
      resolve({ server, url, configPath });
    });

    server.once("error", (error) => {
      reject(error);
    });
  });
}

module.exports = {
  DEFAULT_PORT,
  ensureLocalConfig,
  startLocalApi,
};
