const childProcess = require("child_process");

const MAC_SCRIPT = [
  "on run argv",
  "display notification (item 2 of argv) with title (item 1 of argv)",
  "end run",
].join("\n");

const WINDOWS_SCRIPT = [
  "$title = [Security.SecurityElement]::Escape($args[0])",
  "$message = [Security.SecurityElement]::Escape($args[1])",
  "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
  '$xml.LoadXml("<toast><visual><binding template=\"ToastGeneric\"><text>$title</text><text>$message</text></binding></visual></toast>")',
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("runAlert").Show($toast)',
].join("; ");

function notificationCommand(platform, title, message) {
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", MAC_SCRIPT, String(title), String(message)],
    };
  }
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_SCRIPT,
        String(title),
        String(message),
      ],
    };
  }
  return {
    command: "notify-send",
    args: ["--app-name=runAlert", String(title), String(message)],
  };
}

function sendDesktop(title, message, opts = {}) {
  const spawn = opts.spawn || childProcess.spawn;
  const platform = opts.platform || process.platform;
  const command = notificationCommand(
    platform,
    title || "runAlert",
    message || ""
  );
  return new Promise((resolve) => {
    try {
      const child = spawn(command.command, command.args, {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      child.once?.("error", () => resolve(false));
      child.once?.("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

module.exports = { notificationCommand, sendDesktop };
