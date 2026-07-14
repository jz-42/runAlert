const DESKTOP_API_BASE =
  typeof window !== "undefined" &&
  typeof (window as any).runAlertDesktop?.apiBase === "string"
    ? (window as any).runAlertDesktop.apiBase.trim()
    : "";

export const API_BASE =
  DESKTOP_API_BASE ||
  (typeof import.meta.env.VITE_API_BASE === "string" &&
  import.meta.env.VITE_API_BASE.trim().length > 0
    ? import.meta.env.VITE_API_BASE
    : "");

const TWITCH_STATUS_BASE =
  typeof import.meta.env.VITE_TWITCH_STATUS_BASE === "string" &&
  import.meta.env.VITE_TWITCH_STATUS_BASE.trim().length > 0
    ? import.meta.env.VITE_TWITCH_STATUS_BASE
    : "";

const DEVICE_CREDENTIAL_STORAGE_KEY = "runalert-device-credential-v1";
let cachedCredential: string | null = null;
let credentialPromise: Promise<string> | null = null;
let cachedEnvelope: ConfigEnvelope | null = null;
let bootstrapEnvelope: ConfigEnvelope | null = null;

export type ConfigEnvelope<T = any> = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  config: T;
};

export class ConfigConflictError<T = any> extends Error {
  serverEnvelope: ConfigEnvelope<T>;
  serverValue: T;

  constructor(serverEnvelope: ConfigEnvelope<T>) {
    super("Synced settings changed on another device.");
    this.name = "ConfigConflictError";
    this.serverEnvelope = serverEnvelope;
    this.serverValue = serverEnvelope.config;
  }
}

export function __resetApiTestState() {
  cachedCredential = null;
  credentialPromise = null;
  cachedEnvelope = null;
  bootstrapEnvelope = null;
}

export function isDesktopApp() {
  return (
    typeof window !== "undefined" &&
    !!(window as any).runAlertDesktop
  );
}

function getDesktopTwitchStatusBase() {
  if (!isDesktopApp()) return "";
  const base = (window as any).runAlertDesktop?.twitchStatusBase;
  return typeof base === "string" ? base.trim() : "";
}

function getWindowOrigin() {
  if (typeof window === "undefined") return "";
  const origin = window.location?.origin;
  return typeof origin === "string" ? origin.trim() : "";
}

export function getTwitchStatusBase() {
  if (isDesktopApp()) {
    const desktopBase = getDesktopTwitchStatusBase();
    if (desktopBase) return desktopBase;
    return typeof process !== "undefined" &&
      process.env?.RUNALERT_ELECTRON_DEV === "1"
      ? ""
      : "https://runalert.app";
  }
  return TWITCH_STATUS_BASE || API_BASE || getWindowOrigin();
}

/** @deprecated The v1 client never uses URL or query-string config tokens. */
export function getToken() {
  return "";
}

function isEnvelope(value: any): value is ConfigEnvelope {
  return (
    !!value &&
    value.schemaVersion === 1 &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    typeof value.updatedAt === "string" &&
    !!value.config &&
    typeof value.config === "object"
  );
}

function isConfigObject(value: any) {
  return !!value && typeof value === "object" && Array.isArray(value.streamers);
}

function compatibilityEnvelope(config: any, response: Response): ConfigEnvelope {
  const etagRevision = Number(
    String(response.headers?.get?.("etag") || "").replace(/\D/g, "")
  );
  return {
    schemaVersion: 1,
    revision:
      (Number.isInteger(etagRevision) && etagRevision > 0
        ? etagRevision
        : cachedEnvelope?.revision) || 1,
    updatedAt: new Date().toISOString(),
    config,
  };
}

function readStoredCredential() {
  if (typeof window === "undefined") return "";
  try {
    const value = window.localStorage
      .getItem(DEVICE_CREDENTIAL_STORAGE_KEY)
      ?.trim();
    return value?.startsWith("ra1_") ? value : "";
  } catch {
    return "";
  }
}

function storeCredential(credential: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEVICE_CREDENTIAL_STORAGE_KEY, credential);
    window.localStorage.removeItem("runalert-token");
  } catch {
    // A blocked storage surface will bootstrap again next visit.
  }
}

export async function getDeviceCredential(): Promise<string> {
  if (isDesktopApp()) return "";
  if (cachedCredential) return cachedCredential;
  const stored = readStoredCredential();
  if (stored) {
    cachedCredential = stored;
    return stored;
  }
  if (credentialPromise) return credentialPromise;

  credentialPromise = (async () => {
    const r = await fetch(`${API_BASE}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceName: "Browser",
      }),
    });
    if (!r.ok) throw new Error(`POST /api/devices ${r.status}`);
    const body = await r.json();
    const credential = String(body?.credential || "").trim();
    if (!credential.startsWith("ra1_") || !isEnvelope(body?.envelope)) {
      throw new Error("POST /api/devices returned an invalid response");
    }
    cachedCredential = credential;
    cachedEnvelope = body.envelope;
    bootstrapEnvelope = body.envelope;
    storeCredential(credential);
    return credential;
  })().finally(() => {
    credentialPromise = null;
  });

  return credentialPromise;
}

function authorizationHeaders(credential: string) {
  return { Authorization: `Bearer ${credential}` };
}

async function fetchConfigEnvelope(credential: string) {
  const r = await fetch(`${API_BASE}/api/config`, {
    headers: authorizationHeaders(credential),
  });
  if (!r.ok) throw new Error(`GET /api/config ${r.status}`);
  const envelope = await r.json();
  if (isConfigObject(envelope)) {
    const compatible = compatibilityEnvelope(envelope, r);
    cachedEnvelope = compatible;
    return compatible;
  }
  if (!isEnvelope(envelope)) {
    throw new Error("GET /api/config returned an invalid envelope");
  }
  cachedEnvelope = envelope;
  return envelope;
}

export async function getConfig() {
  if (isDesktopApp()) {
    try {
      const synced = await (window as any).runAlertDesktop?.sync?.pull?.();
      if (synced?.config) return synced.config;
      if (synced?.envelope?.config) return synced.envelope.config;
    } catch {
      // The loopback copy remains available while the network is offline.
    }
    const r = await fetch(`${API_BASE}/config`);
    if (!r.ok) throw new Error(`GET /config ${r.status}`);
    const body = await r.json();
    return body?.config && body?.ok ? body.config : body;
  }

  const credential = await getDeviceCredential();
  if (bootstrapEnvelope) {
    const envelope = bootstrapEnvelope;
    bootstrapEnvelope = null;
    return envelope.config;
  }
  return (await fetchConfigEnvelope(credential)).config;
}

export async function putConfig(cfg: unknown) {
  return putConfigRaw(cfg);
}

export async function putConfigRaw(cfg: unknown) {
  if (isDesktopApp()) {
    const r = await fetch(`${API_BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    if (!r.ok) throw new Error(`PUT /config ${r.status}`);
    const body = await r.json().catch(() => ({}));
    const localConfig = body?.config ?? body;
    const synced = await (window as any).runAlertDesktop?.sync?.putConfig?.(
      localConfig
    );
    return synced?.config ?? synced?.envelope?.config ?? localConfig;
  }

  const credential = await getDeviceCredential();
  if (!cachedEnvelope) await fetchConfigEnvelope(credential);
  const expectedRevision = cachedEnvelope!.revision;
  const r = await fetch(`${API_BASE}/api/config`, {
    method: "PUT",
    headers: {
      ...authorizationHeaders(credential),
      "Content-Type": "application/json",
      "If-Match": `"${expectedRevision}"`,
    },
    body: JSON.stringify({ expectedRevision, config: cfg }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 409 && isEnvelope(body?.envelope)) {
    cachedEnvelope = body.envelope;
    throw new ConfigConflictError(body.envelope);
  }
  if (!r.ok) throw new Error(`PUT /api/config ${r.status}`);
  if (isEnvelope(body)) {
    cachedEnvelope = body;
    return body.config;
  }
  const compatibleConfig = isConfigObject(body)
    ? body
    : isConfigObject(body?.config)
      ? body.config
      : cfg;
  cachedEnvelope = {
    ...compatibilityEnvelope(compatibleConfig, r),
    revision: expectedRevision + 1,
  };
  return compatibleConfig;
}

export async function createPairingLink(deviceName = "Desktop app") {
  const credential = await getDeviceCredential();
  const r = await fetch(`${API_BASE}/api/pairing-links`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(credential),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deviceName }),
  });
  if (!r.ok) throw new Error(`POST /api/pairing-links ${r.status}`);
  return r.json();
}

export async function exchangePairingCode(code: string, deviceName: string) {
  if (isDesktopApp() && (window as any).runAlertDesktop?.sync?.pair) {
    return (window as any).runAlertDesktop.sync.pair({ code, deviceName });
  }
  const r = await fetch(`${API_BASE}/api/pair/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
  if (!r.ok) throw new Error(`POST /api/pair/exchange ${r.status}`);
  return r.json();
}

export async function getReleaseManifest() {
  const r = await fetch(`${API_BASE}/api/releases/stable`);
  if (!r.ok) throw new Error(`GET /api/releases/stable ${r.status}`);
  return r.json();
}

export function subscribeConfigChanges(
  onRevision: (revision: number | null, source: "event" | "poll") => void,
  {
    pollIntervalMs = 60_000,
    reconnectDelayMs = 3_000,
  }: { pollIntervalMs?: number; reconnectDelayMs?: number } = {}
) {
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activeController: AbortController | null = null;
  const pollTimer = window.setInterval(() => {
    if (!stopped) onRevision(null, "poll");
  }, pollIntervalMs);

  async function connect() {
    if (stopped || isDesktopApp()) return;
    try {
      const credential = await getDeviceCredential();
      activeController = new AbortController();
      const response = await fetch(`${API_BASE}/api/config/events`, {
        headers: authorizationHeaders(credential),
        signal: activeController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`GET /api/config/events ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = block
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (dataLine) {
            try {
              const event = JSON.parse(dataLine.slice(5).trim());
              if (event?.type === "revision" && Number.isInteger(event.revision)) {
                onRevision(event.revision, "event");
              }
            } catch {
              // Ignore malformed event frames and keep the authenticated stream alive.
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error: any) {
      if (stopped || error?.name === "AbortError") return;
    }
    if (!stopped) reconnectTimer = setTimeout(connect, reconnectDelayMs);
  }

  void connect();
  return () => {
    stopped = true;
    window.clearInterval(pollTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    activeController?.abort();
  };
}

export async function testNotify(title?: string, message?: string) {
  const r = await fetch(`${API_BASE}/notify/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message }),
  });
  if (!r.ok) throw new Error(`POST /notify/test ${r.status}`);
  return r.json();
}

export async function getPacemanMilestones(name: string) {
  const r = await fetch(
    `${API_BASE}/paceman/milestones?name=${encodeURIComponent(name)}`
  );
  if (!r.ok) throw new Error(`GET /paceman/milestones ${r.status}`);
  return r.json() as Promise<{ ok: boolean; runId: number | null; milestones: string[] }>;
}

export async function getProfiles(names: string[]) {
  const unique = Array.from(
    new Set(names.map((n) => String(n || "").trim()).filter(Boolean))
  );
  if (!unique.length) return { ok: true, profiles: {} as Record<string, any> };

  const r = await fetch(
    `${API_BASE}/profiles?names=${encodeURIComponent(unique.join(","))}`
  );
  if (!r.ok) throw new Error(`GET /profiles ${r.status}`);
  const body = await r.json();
  const profiles =
    body && typeof body === "object" && body.profiles && typeof body.profiles === "object"
      ? body.profiles
      : {};
  return { ok: true, profiles } as {
    ok: true;
    profiles: Record<
      string,
      {
        runId: number | null;
        twitch: string | null;
        uuid: string | null;
        avatarUrl: string | null;
      }
    >;
  };
}

export async function getStatuses(names: string[]) {
  const unique = Array.from(
    new Set(names.map((n) => String(n || "").trim()).filter(Boolean))
  );
  if (!unique.length) return { ok: true, statuses: {} as Record<string, any> };

  const r = await fetch(
    `${API_BASE}/status?names=${encodeURIComponent(unique.join(","))}`
  );
  if (!r.ok) throw new Error(`GET /status ${r.status}`);
  const body = await r.json();
  const statuses =
    body && typeof body === "object" && body.statuses && typeof body.statuses === "object"
      ? body.statuses
      : {};
  return { ok: true, statuses } as {
    ok: true;
    statuses: Record<
      string,
      {
        runId: number | null;
        isLive: boolean;
        isActive?: boolean;
        runIsActive?: boolean;
        lastUpdatedSec?: number | null;
        runStartSec?: number | null;
        lastMilestone?: string | null;
        lastMilestoneMs?: number | null;
        splits?: Record<string, { igt?: number | null; rta?: number | null }>;
        recentFinishMs?: number | null;
        recentFinishUpdatedSec?: number | null;
      }
    >;
  };
}

export async function getTwitchStatuses(
  names: string[],
  base = getTwitchStatusBase()
) {
  const unique = Array.from(
    new Set(names.map((n) => String(n || "").trim()).filter(Boolean))
  );
  if (!unique.length) return { ok: true, statuses: {} as Record<string, any> };
  if (!base) return { ok: true, statuses: {} as Record<string, any> };

  const r = await fetch(
    `${base}/twitch/status?names=${encodeURIComponent(unique.join(","))}`
  );
  if (!r.ok) throw new Error(`GET /twitch/status ${r.status}`);
  const body = await r.json();
  const statuses =
    body && typeof body === "object" && body.statuses && typeof body.statuses === "object"
      ? body.statuses
      : {};
  return { ok: true, statuses } as {
    ok: true;
    statuses: Record<
      string,
      {
        isTwitchLive?: boolean;
        twitch?: string | null;
      }
    >;
  };
}
