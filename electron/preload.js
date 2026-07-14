const { contextBridge, ipcRenderer } = require("electron");

function argumentValue(prefix) {
  const entry = process.argv.find((value) => String(value).startsWith(prefix));
  return entry ? String(entry).slice(prefix.length) : "";
}

function unwrapSyncResult(result) {
  if (result?.ok !== false) return result?.value ?? result;
  if (result.conflict) {
    const error = new Error("Synced settings changed on another device.");
    error.name = "ConfigConflictError";
    error.serverValue = result.serverEnvelope?.config;
    error.serverEnvelope = result.serverEnvelope;
    throw error;
  }
  throw new Error(result?.message || "Desktop sync failed.");
}

contextBridge.exposeInMainWorld("runAlertDesktop", {
  platform: process.platform,
  apiBase: argumentValue("--runalert-api-base="),
  twitchStatusBase: process.env.RUNALERT_TWITCH_STATUS_BASE || "",
  sync: {
    pull: () => ipcRenderer.invoke("runalert:sync:pull").then(unwrapSyncResult),
    putConfig: (config) =>
      ipcRenderer.invoke("runalert:sync:push", config).then(unwrapSyncResult),
    pair: (payload) =>
      ipcRenderer.invoke("runalert:sync:pair", payload).then(unwrapSyncResult),
    isPaired: () => ipcRenderer.invoke("runalert:sync:is-paired"),
  },
  updates: {
    getState: () => ipcRenderer.invoke("runalert:updates:get-state"),
    restart: () => ipcRenderer.invoke("runalert:updates:restart"),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("runalert:updates:state", handler);
      return () => ipcRenderer.removeListener("runalert:updates:state", handler);
    },
  },
});
