type AnalyticsConfig = {
  posthogKey?: string;
  host?: string;
};

type AnalyticsProperties = Record<string, string | number | boolean | null>;

declare global {
  interface Window {
    runAlertAnalytics?: AnalyticsConfig;
  }
}

const DISTINCT_ID_KEY = "runalert-analytics-distinct-id";
const DEFAULT_HOST = "https://app.posthog.com";

function readRuntimeConfig(): AnalyticsConfig {
  if (typeof window !== "undefined" && window.runAlertAnalytics) {
    return window.runAlertAnalytics;
  }

  const env = import.meta.env as Record<string, unknown>;
  return {
    posthogKey:
      typeof env.VITE_POSTHOG_KEY === "string" ? env.VITE_POSTHOG_KEY : "",
    host:
      typeof env.VITE_POSTHOG_HOST === "string" && env.VITE_POSTHOG_HOST.trim()
        ? env.VITE_POSTHOG_HOST
        : DEFAULT_HOST,
  };
}

function readDistinctId() {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(DISTINCT_ID_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // ignore storage failures
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    window.localStorage.setItem(DISTINCT_ID_KEY, id);
  } catch {
    // ignore storage failures
  }
  return id;
}

function sanitizeProperties(
  props: Record<string, unknown> | undefined
): AnalyticsProperties {
  const out: AnalyticsProperties = {
    $lib: "runalert-web",
    $current_url:
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "",
  };

  if (!props || typeof props !== "object") return out;

  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }

  return out;
}

function createCapturePayload(
  event: string,
  props?: Record<string, unknown>
) {
  const config = readRuntimeConfig();
  return {
    api_key: config.posthogKey,
    event,
    properties: sanitizeProperties(props),
    distinct_id: readDistinctId(),
  };
}

export function getDistinctId() {
  return readDistinctId();
}

export async function trackEvent(
  event: string,
  props?: Record<string, unknown>
): Promise<boolean> {
  const config = readRuntimeConfig();
  if (!config.posthogKey) return false;
  if (typeof window === "undefined") return false;

  const payload = createCapturePayload(event, props);
  const host = config.host?.trim() || DEFAULT_HOST;
  const url = `${host.replace(/\/$/, "")}/capture/`;
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    return navigator.sendBeacon(url, body);
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });
  return r.ok;
}
