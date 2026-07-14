const { startLocalApi } = require("./local_api");
const { startWatcher } = require("./watcher_process");

async function startDesktopServices({
  userDataPath,
  bundledConfigPath,
  startLocalApi: startLocalApiImpl = startLocalApi,
  startWatcher: startWatcherImpl = startWatcher,
} = {}) {
  const localApi = await startLocalApiImpl({
    userDataPath,
    bundledConfigPath,
  });

  const watcher = startWatcherImpl({
    userDataPath,
    configPath: localApi.configPath,
    notifyApiUrl: `${localApi.url}/notify`,
  });

  return {
    apiUrl: localApi.url,
    configPath: localApi.configPath,
    stop() {
      watcher.stop();
      localApi.server.close();
    },
  };
}

module.exports = {
  startDesktopServices,
};
