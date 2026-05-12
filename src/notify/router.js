// notify/index.js
const { sendDesktop } = require("./desktop_channel");

async function forwardToDesktopBridge(payload) {
  const url = String(process.env.RUNALERT_NOTIFY_API_URL || "").trim();
  if (!url || typeof fetch !== "function") return false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function send({ channel = "desktop", title, message, ...rest }) {
  if (channel === "desktop") {
    const forwarded = await forwardToDesktopBridge({
      channel,
      title,
      message,
      ...rest,
    });
    if (forwarded) return;
    return sendDesktop(title, message, rest);
  }
  // Future: 'discord', 'sms', 'voice' etc.
}

module.exports = { send };
