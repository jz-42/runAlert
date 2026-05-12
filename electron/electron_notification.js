const path = require("path");

function resolveNotificationIconPath(baseDir = __dirname) {
  const packagedIcon = path.join(process.resourcesPath || "", "icon.icns");
  const devIcon = path.join(baseDir, "..", "dashboard", "public", "icon-1024.png");

  if (process.resourcesPath && require("fs").existsSync(packagedIcon)) {
    return packagedIcon;
  }
  return devIcon;
}

async function sendElectronDesktop({
  title,
  message,
  openUrl,
  sound = true,
  iconPath = resolveNotificationIconPath(),
  NotificationImpl,
  shellImpl,
} = {}) {
  const { Notification, shell } = require("electron");
  const Notifier = NotificationImpl || Notification;
  const shellApi = shellImpl || shell;

  if (!Notifier || typeof Notifier.isSupported === "function" && !Notifier.isSupported()) {
    return false;
  }

  const notification = new Notifier({
    title: String(title || "runAlert"),
    body: String(message || ""),
    silent: !sound,
    icon: iconPath,
  });

  if (openUrl) {
    notification.on("click", () => {
      shellApi.openExternal(String(openUrl));
    });
  }

  notification.show();
  return true;
}

module.exports = {
  resolveNotificationIconPath,
  sendElectronDesktop,
};
