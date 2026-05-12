// notify/desktop.js (CommonJS)
const notifier = require("node-notifier");
const { spawn } = require("child_process");
const fs = require("fs");

function openUrl(url) {
  if (!url) return;
  const u = String(url);
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawn("open", [u], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", u], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      spawn("xdg-open", [u], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // best-effort
  }
}

/**
 * Show a system desktop notification (macOS/Windows/Linux).
 * @param {string} title
 * @param {string} message
 * @param {{ openUrl?: string, wait?: boolean, actions?: string[], timeout?: number }} [opts]
 */
function sendDesktop(title, message, opts = {}) {
  return new Promise((resolve) => {
    const open = opts.openUrl ? String(opts.openUrl) : undefined;
    const platform = process.platform;
    const configuredIcon = String(
      opts.iconPath || process.env.RUNALERT_NOTIFICATION_ICON || ""
    ).trim();
    const icon =
      configuredIcon && fs.existsSync(configuredIcon) ? configuredIcon : undefined;
    
    notifier.notify(
      {
        title,
        message,
        icon,
        // `wait` keeps the notifier process alive so we can react to clicks/actions.
        wait: opts.wait ?? Boolean(open),
        // Terminal-notifier supports "actions" (macOS). Other platforms may ignore this.
        actions: opts.actions,
        // Some platforms honor timeout=0 as "do not auto-dismiss"; others ignore.
        timeout: opts.timeout,
        sound: opts.sound ?? true,
      },
      (_err, response, metadata) => {
        const activationType =
          metadata && typeof metadata === "object"
            ? metadata.activationType
            : null;

        const clicked =
          response === "activate" ||
          response === "click" ||
          activationType === "contentsClicked" ||
          activationType === "actionClicked";

        if (clicked && open) {
          openUrl(open);
        }
        resolve();
      }
    );
  });
}

module.exports = { sendDesktop };
