const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("runAlertDesktop", {
  platform: process.platform,
  twitchStatusBase: process.env.RUNALERT_TWITCH_STATUS_BASE || "",
});
