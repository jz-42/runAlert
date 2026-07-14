function parsePairingDeepLink(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "runalert:" || url.hostname !== "pair") return null;
    if (url.searchParams.has("credential") || url.searchParams.has("token")) {
      return null;
    }
    const exchange = String(url.searchParams.get("exchange") || "").trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(exchange)) return null;
    return { exchange };
  } catch {
    return null;
  }
}

function findPairingDeepLink(argv = []) {
  for (const value of argv) {
    const parsed = parsePairingDeepLink(value);
    if (parsed) return parsed;
  }
  return null;
}

module.exports = {
  findPairingDeepLink,
  parsePairingDeepLink,
};
