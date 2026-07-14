const EXTERNAL_HOSTS = new Set([
  "runalert.app",
  "www.runalert.app",
  "twitch.tv",
  "www.twitch.tv",
  "paceman.gg",
  "www.paceman.gg",
  "github.com",
]);

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedRendererNavigation(value, rendererOrigin) {
  try {
    const url = new URL(String(value || ""));
    return url.origin === String(rendererOrigin || "");
  } catch {
    return false;
  }
}

module.exports = {
  EXTERNAL_HOSTS,
  isAllowedExternalUrl,
  isAllowedRendererNavigation,
};
