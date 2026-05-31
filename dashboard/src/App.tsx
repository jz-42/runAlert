import "./App.css";

import React, { useEffect, useRef, useState } from "react";
import {
  API_BASE,
  getConfig,
  getProfiles,
  getStatuses,
  getTwitchStatuses,
  getToken,
  isDesktopApp,
  testNotify,
  putConfig,
} from "./api";
import { trackEvent } from "./analytics";
import { CANONICAL_MILESTONES, milestoneLabel } from "./config";

type MilestoneCfg = { thresholdSec?: number; enabled?: boolean };
type Config = {
  streamers: string[];
  clock: string;
  // Back-compat: string "HH:MM-HH:MM". New: string[] of such ranges (multi-span).
  quietHours?: string | string[];
  profiles?: Record<string, Record<string, MilestoneCfg>>;
  defaultMilestones?: Record<string, MilestoneCfg>;
  notifications?: {
    enabled?: boolean;
    sound?: boolean;
  };
  agent?: {
    autoUpdate?: boolean;
    backgroundMonitoring?: boolean;
  };
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function splitMMSS(thresholdSec?: number): { mm: string; ss: string } {
  if (thresholdSec == null || !Number.isFinite(thresholdSec))
    return { mm: "", ss: "" };
  const total = Math.max(0, Math.trunc(thresholdSec));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return { mm: String(mm), ss: String(ss).padStart(2, "0") };
}

const APP_VERSION = "0.2";
const APP_CHANNEL = "Beta";
const MAX_STREAMERS = 15;
const MAX_QUIET_SPANS = 3;
const BROWSER_ALERTS_KEY = "runalert-browser-alerts";
const BROWSER_ALERTS_DEDUPE_KEY = "runalert-browser-alerts-dedupe";
const ONBOARDING_DISMISSED_KEY = "runalert-onboarding-dismissed";
const APP_FIRST_OPENED_KEY = "runalert-app-first-opened";
const DESKTOP_BG_RUNNING_KEY = "runalert-desktop-background-running";
const GITHUB_REPO_URL = "https://github.com/jz-42/runAlert";
const GITHUB_BETA_RELEASE_URL =
  "https://github.com/jz-42/runAlert/releases/tag/v0.1.0-beta.2";

type AmPm = "AM" | "PM";
type Time12 = { hh: string; mm: string; ampm: AmPm };
type QuietSpanDraft = { start: Time12; end: Time12 };
type InstallGuidePlatform = "mac" | "windows";
type InstallGuideStep = {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  details?: React.ReactNode[];
  note?: React.ReactNode;
  imageSrc?: string;
  imageAlt?: string;
};

const INSTALL_GUIDES: Record<InstallGuidePlatform, InstallGuideStep[]> = {
  mac: [
    {
      eyebrow: "Step 1",
      title: "Download runAlert",
      body: (
        <>
          Click Download DMG (
          <span className="installGuideEmphasisDownload">
            runAlert-0.1.0-beta.2-arm64.dmg
          </span>
          ).
        </>
      ),
      details: [
        "The download comes from runalert.app and the public GitHub release for jz-42/runAlert.",
        "No account required.",
      ],
      note: (
        <>
          <span className="installGuideNoteLabel">
            ⚠️ Important Security Note:
          </span>{" "}
          To verify this app is safe, send the{" "}
          <a
            className="installGuideInlineLink"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            public source code
          </a>{" "}
          link to your preferred AI and upload your{" "}
          <span className="installGuideEmphasisDownload">download file</span> to
          scan for anything malicious. For a manual check, you can also review
          the{" "}
          <a
            className="installGuideInlineLink"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            public source code
          </a>{" "}
          yourself and verify the{" "}
          <a
            className="installGuideInlineLink installGuideInlineLink--checksum"
            href={GITHUB_BETA_RELEASE_URL}
            target="_blank"
            rel="noreferrer"
          >
            checksum
          </a>{" "}
          matches your download.
        </>
      ),
      imageSrc: "/install-guide/step-1-downloaded-dmg.png",
      imageAlt: "Downloaded runAlert disk image shown in the macOS downloads area",
    },
    {
      eyebrow: "Step 2",
      title: "Open the DMG and drag runAlert to Applications",
      body: "Open the downloaded file, then drag runAlert into Applications.",
      imageSrc: "/install-guide/step-2-drag-to-applications.png",
      imageAlt: "runAlert disk image showing the app being dragged into Applications",
    },
    {
      eyebrow: "Step 3",
      title: "Try opening runAlert",
      body:
        "Open runAlert from Applications. macOS may say Apple cannot verify the app.",
      details: [
        "That warning is expected for this beta because the app is unsigned by Apple.",
      ],
      imageSrc: "/install-guide/step-3-gatekeeper-warning.png",
      imageAlt: "macOS gatekeeper warning shown when first opening runAlert",
    },
    {
      eyebrow: "Step 4",
      title: "Click Open Anyway",
      body:
        "Given that you've verified security yourself, feel free to override this. If your Mac blocks it, go to Settings → Privacy & Security and click Open Anyway. Then open the app again.",
      imageSrc: "/install-guide/step-4-open-anyway.png",
      imageAlt: "macOS Privacy & Security page showing the Open Anyway button for runAlert",
    },
  ],
  windows: [
    {
      eyebrow: "Step 1",
      title: "Download runAlert",
      body: "Click Download EXE.",
    },
    {
      eyebrow: "Step 2",
      title: "Open the installer",
      body: "Run the installer and follow the prompts.",
    },
    {
      eyebrow: "Step 3",
      title: "Turn on notifications",
      body: "Turn on notifications for runAlert in Windows.",
    },
  ],
};

const SPECIAL_STREAMER_AVATARS: Record<string, string> = {
  stableronaldo: "/special-streamers/stableronaldo.png",
  forsen: "/special-streamers/forsen.png",
  ohnepixel: "/special-streamers/ohnepixel.png",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function normalizeQuietHoursToArray(q: Config["quietHours"]): string[] {
  if (!q) return [];
  if (Array.isArray(q)) return q.filter((s) => typeof s === "string");
  if (typeof q === "string") return [q];
  return [];
}

function parseHHMM(s: string): { hh: number; mm: number } | null {
  const m = String(s || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function isTimeInQuietRange(range: string, date = new Date()): boolean {
  const parts = String(range || "").split("-");
  if (parts.length !== 2) return false;
  const start = parseHHMM(parts[0]);
  const end = parseHHMM(parts[1]);
  if (!start || !end) return false;

  const now = date.getHours() * 60 + date.getMinutes();
  const startMin = start.hh * 60 + start.mm;
  const endMin = end.hh * 60 + end.mm;

  if (startMin === endMin) return true;
  if (startMin < endMin) return now >= startMin && now < endMin;
  return now >= startMin || now < endMin;
}

function inQuietHours(q: Config["quietHours"], date = new Date()): boolean {
  const ranges = normalizeQuietHoursToArray(q);
  for (const r of ranges) {
    if (isTimeInQuietRange(r, date)) return true;
  }
  return false;
}

function to12({ hh, mm }: { hh: number; mm: number }): Time12 {
  const ampm: AmPm = hh >= 12 ? "PM" : "AM";
  const hh12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hh: String(hh12), mm: pad2(mm), ampm };
}

function to24(t: Time12): { hh: number; mm: number } | null {
  const hhRaw = t.hh.trim();
  const mmRaw = t.mm.trim();
  if (!hhRaw || !mmRaw) return null;
  const hh12 = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh12) || !Number.isFinite(mm)) return null;
  if (hh12 < 1 || hh12 > 12) return null;
  if (mm < 0 || mm > 59) return null;
  const base = hh12 % 12; // 12 -> 0
  const hh = t.ampm === "PM" ? base + 12 : base;
  return { hh, mm };
}

function parseQuietRangeToDraft(range: string): QuietSpanDraft | null {
  const parts = String(range || "").split("-");
  if (parts.length !== 2) return null;
  const a = parseHHMM(parts[0]);
  const b = parseHHMM(parts[1]);
  if (!a || !b) return null;
  return { start: to12(a), end: to12(b) };
}

function formatTime12(t: Time12): string {
  const hh = t.hh.trim() || "—";
  const mm = t.mm.trim() || "—";
  return `${hh}:${mm} ${t.ampm}`;
}

function formatQuietHoursSummary(q: Config["quietHours"]): string {
  const ranges = normalizeQuietHoursToArray(q);
  const parts: string[] = [];
  for (const r of ranges) {
    const d = parseQuietRangeToDraft(r);
    if (!d) continue;
    parts.push(`${formatTime12(d.start)}–${formatTime12(d.end)}`);
  }
  if (!parts.length) return "None";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} +${parts.length - 1}`;
}

function defaultQuietSpan(): QuietSpanDraft {
  return {
    start: { hh: "10", mm: "00", ampm: "PM" },
    end: { hh: "7", mm: "00", ampm: "AM" },
  };
}

function stripLegacyForsenConfig(config: Config): Config {
  const next = structuredClone(config);
  const agent = next.agent as ({ autoUpdate?: boolean } & {
    forsenOcr?: boolean;
  }) | null | undefined;
  if (!agent || !Object.prototype.hasOwnProperty.call(agent, "forsenOcr")) {
    return next;
  }
  delete agent.forsenOcr;
  if (!Object.keys(agent).length) {
    delete next.agent;
  }
  return next;
}

function App() {
  const desktopApp = isDesktopApp();
  const [showSettings, setShowSettings] = useState(false);
  const [showQuietHours, setShowQuietHours] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [showAddStreamer, setShowAddStreamer] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [installCopied, setInstallCopied] = useState<"mac" | "windows" | null>(
    null
  );
  const [showInstallDetails, setShowInstallDetails] = useState(false);
  const [installGuidePlatform, setInstallGuidePlatform] =
    useState<InstallGuidePlatform>("mac");
  const [installGuideStep, setInstallGuideStep] = useState(0);
  const [addStreamerName, setAddStreamerName] = useState("");
  const [addStreamerErr, setAddStreamerErr] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const [copyFallbackCommand, setCopyFallbackCommand] = useState("");
  const [copyFallbackTitle, setCopyFallbackTitle] =
    useState("Copy install command");

  const [draft, setDraft] = useState<Record<string, MilestoneCfg>>({});
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = useState(false);
  const [browserAlertsErr, setBrowserAlertsErr] = useState<string | null>(null);
  const [allToggleOn, setAllToggleOn] = useState(true);
  const [allToggleOwner, setAllToggleOwner] = useState<string | null>(null);

  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quietDraft, setQuietDraft] = useState<QuietSpanDraft[]>([]);
  const [quietErr, setQuietErr] = useState<string | null>(null);
  const [quietSaving, setQuietSaving] = useState(false);
  const [quietSaved, setQuietSaved] = useState(false);
  const [confirmRemoveQH, setConfirmRemoveQH] = useState<number | null>(null);
  const [milestoneSaved, setMilestoneSaved] = useState(false);
  const milestoneSavedTimerRef = useRef<number | null>(null);
  const [statusByName, setStatusByName] = useState<
    Record<
      string,
      {
        runId: number | null;
        isLive: boolean;
        isActive?: boolean;
        runIsActive?: boolean;
        isTwitchLive?: boolean;
        twitch?: string | null;
        lastMilestone?: string | null;
        lastMilestoneMs?: number | null;
        lastUpdatedSec?: number | null;
        runStartSec?: number | null;
        recentFinishMs?: number | null;
        recentFinishUpdatedSec?: number | null;
      }
    >
  >({});
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [twitchStatusByName, setTwitchStatusByName] = useState<
    Record<
      string,
      {
        isTwitchLive?: boolean;
        twitch?: string | null;
      }
    >
  >({});
  const [profileByName, setProfileByName] = useState<
    Record<string, { avatarUrl: string | null; twitch?: string | null }>
  >({});

  const [dragCandidate, setDragCandidate] = useState<{
    index: number;
    name: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const [dragState, setDragState] = useState<{
    index: number;
    name: string;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    insertIndex: number;
  } | null>(null);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratingDraftRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const suppressOpenRef = useRef(false);
  const browserAlertDedupeRef = useRef<
    Record<string, { runId: number | null; milestones: Record<string, boolean> }>
  >({});

  const installToken = getToken();
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const installBase = API_BASE || origin;
  const installChannel = "stable";
  const installQuery = new URLSearchParams();
  if (installToken) installQuery.set("token", installToken);
  installQuery.set("channel", installChannel);
  const installQueryString = installQuery.toString();

  const macInstallUrl = `${installBase}/install/macos.command${
    installQueryString ? `?${installQueryString}` : ""
  }`;
  const windowsInstallUrl = `${installBase}/install/windows.ps1${
    installQueryString ? `?${installQueryString}` : ""
  }`;
  const macViewInstallUrl = `${macInstallUrl}${
    macInstallUrl.includes("?") ? "&" : "?"
  }view=1`;
  const windowsViewInstallUrl = `${windowsInstallUrl}${
    windowsInstallUrl.includes("?") ? "&" : "?"
  }view=1`;
  const macInstallCommand = `curl -fsSL "${macViewInstallUrl}" | bash`;
  const windowsInstallCommand = `powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr -useb '${windowsInstallUrl}' | iex"`;
  const appDownloadBase = API_BASE || "";
  const macAppDownloadUrl = `${appDownloadBase}/download/macos/dmg`;
  const macAppZipUrl = `${appDownloadBase}/download/macos/zip`;
  const windowsAppDownloadUrl = `${appDownloadBase}/download/windows/exe`;
  const streamers: string[] = cfg?.streamers ?? [];

  const milestoneEntries = Object.entries(draft);
  const anyMilestones = milestoneEntries.length > 0;
  const allEnabled =
    anyMilestones && milestoneEntries.every(([, cfg]) => cfg.enabled ?? true);
  const anyEnabled = milestoneEntries.some(([, cfg]) => cfg.enabled ?? true);
  const notificationsEnabled = cfg?.notifications?.enabled ?? true;
  const notificationSoundEnabled = cfg?.notifications?.sound ?? true;
  const agentAutoUpdateEnabled = cfg?.agent?.autoUpdate ?? false;
  const backgroundMonitoringEnabled = cfg?.agent?.backgroundMonitoring ?? false;

  function applyConfig(next: Config) {
    setCfg(stripLegacyForsenConfig(next));
  }

  function getTwitchUrl(name: string) {
    const raw =
      profileByName[name]?.twitch ||
      twitchStatusByName?.[name]?.twitch ||
      statusByName?.[name]?.twitch ||
      name;
    const handle = String(raw || "").trim();
    if (!handle) return null;
    return `https://twitch.tv/${encodeURIComponent(handle)}`;
  }

  function getPacemanStatsUrl(name: string) {
    const handle = String(name || "").trim();
    if (!handle) return null;
    return `https://paceman.gg/stats/player/${encodeURIComponent(handle)}/runs/`;
  }

  function getAvatarSrc(name: string): string | null {
    const normalized = String(name || "").trim().toLowerCase();
    if (normalized && SPECIAL_STREAMER_AVATARS[normalized]) {
      return SPECIAL_STREAMER_AVATARS[normalized];
    }
    return profileByName[name]?.avatarUrl ?? null;
  }

  function isStreamerLive(name: string): boolean {
    const s = twitchStatusByName?.[name];
    return s?.isTwitchLive === true;
  }

  async function copyInstallCommand(command: string, platform: "mac" | "windows") {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        setInstallCopied(platform);
        setTimeout(() => {
          setInstallCopied((prev) => (prev === platform ? null : prev));
        }, 1800);
        return;
      }
    } catch {
      // fall through to manual prompt
    }
    setCopyFallbackCommand(command);
    setCopyFallbackTitle(
      platform === "mac" ? "Copy macOS install command" : "Copy Windows install command"
    );
    setShowCopyFallback(true);
  }

  function persistBrowserAlerts(enabled: boolean) {
    setBrowserAlertsEnabled(enabled);
    try {
      window.localStorage.setItem(BROWSER_ALERTS_KEY, String(enabled));
    } catch {
      // ignore storage failures
    }
  }

  async function enableBrowserAlerts() {
    setBrowserAlertsErr(null);
    if (typeof Notification === "undefined") {
      setBrowserAlertsErr("Browser notifications are not supported here.");
      return;
    }
    if (Notification.permission === "granted") {
      persistBrowserAlerts(true);
      void trackEvent("browser_alerts_enabled", { enabled: true });
      return;
    }
    if (Notification.permission === "denied") {
      setBrowserAlertsErr(
        "Notifications are blocked in this browser. Enable them in browser settings."
      );
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      persistBrowserAlerts(true);
      void trackEvent("browser_alerts_enabled", { enabled: true });
    } else {
      setBrowserAlertsErr("Notification permission was denied.");
    }
  }

  function disableBrowserAlerts() {
    setBrowserAlertsErr(null);
    persistBrowserAlerts(false);
  }

  function updateNotificationPrefs({
    enabled = notificationsEnabled,
    sound = notificationSoundEnabled,
  }: {
    enabled?: boolean;
    sound?: boolean;
  }) {
    if (!cfg) return;
    const updated = structuredClone(cfg);
    updated.notifications = {
      ...(updated.notifications || {}),
      enabled,
      sound,
    };
    applyConfig(updated);
    setErr(null);
    void putConfig(stripLegacyForsenConfig(updated)).catch((e) =>
      setErr(e?.message ?? String(e))
    );
  }

  function toggleNotificationsEnabled(next: boolean) {
    updateNotificationPrefs({ enabled: next });
  }

  function toggleNotificationSound(next: boolean) {
    updateNotificationPrefs({ sound: next });
  }

  function updateBackgroundMonitoring(next: boolean) {
    if (!cfg) return;
    const updated = structuredClone(cfg);
    updated.agent = {
      ...(updated.agent || {}),
      autoUpdate: updated.agent?.autoUpdate ?? agentAutoUpdateEnabled,
      backgroundMonitoring: next,
    };
    applyConfig(updated);
    setErr(null);
    void putConfig(stripLegacyForsenConfig(updated)).catch((e) =>
      setErr(e?.message ?? String(e))
    );
  }

  function dismissOnboarding() {
    setShowOnboarding(false);
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    } catch {
      // ignore storage failures
    }
  }

  function loadBrowserAlertDedupe() {
    try {
      const raw = window.localStorage.getItem(BROWSER_ALERTS_DEDUPE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        browserAlertDedupeRef.current = parsed;
      }
    } catch {
      // ignore
    }
  }

  function saveBrowserAlertDedupe() {
    try {
      window.localStorage.setItem(
        BROWSER_ALERTS_DEDUPE_KEY,
        JSON.stringify(browserAlertDedupeRef.current)
      );
    } catch {
      // ignore
    }
  }

  function getDedupeEntry(name: string, runId: number) {
    const cur = browserAlertDedupeRef.current[name];
    if (!cur || cur.runId !== runId) {
      browserAlertDedupeRef.current[name] = {
        runId,
        milestones: {},
      };
    }
    return browserAlertDedupeRef.current[name];
  }

  function shouldNotifyBrowserAlert(
    name: string,
    milestone: string,
    ms: number | null | undefined
  ) {
    if (!cfg) return false;
    if (!Number.isFinite(ms) || (ms as number) < 0) return false;
    const merged = getMilestonesForStreamer(name)[milestone];
    if (!merged || !merged.enabled) return false;
    const thresholdSec = merged.thresholdSec;
    if (!Number.isFinite(thresholdSec) || (thresholdSec as number) <= 0)
      return false;
    return (ms as number) <= (thresholdSec as number) * 1000;
  }

  function maybeSendBrowserAlerts(statuses: Record<string, any>) {
    if (!cfg || !browserAlertsEnabled) return;
    if (!notificationsEnabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (inQuietHours(cfg.quietHours)) return;

    const clock = String(cfg.clock || "IGT").toUpperCase();
    const clockKey = clock === "RTA" ? "rta" : "igt";

    for (const name of cfg.streamers ?? []) {
      const status = statuses?.[name];
      if (!status?.runId || status?.runIsActive !== true) continue;
      const splits = status?.splits;
      if (!splits || typeof splits !== "object") continue;

      const entry = getDedupeEntry(name, status.runId);
      for (const milestone of CANONICAL_MILESTONES) {
        const ms = splits?.[milestone]?.[clockKey];
        if (!shouldNotifyBrowserAlert(name, milestone, ms)) continue;
        if (entry.milestones?.[milestone]) continue;

        const time = formatRunTime(ms) ?? "—";
        const label = milestoneBadgeText(milestone);
        const emoji = milestoneEmoji(milestone);
        const title = `${label}${emoji ? ` ${emoji}` : ""} — ${time} (${name})`;
        const streamUrl = getTwitchUrl(name);
        try {
          const notify = new Notification(title, {
            tag: `${name}-${milestone}-${status.runId}`,
            requireInteraction: true,
            silent: !notificationSoundEnabled,
          });
          if (streamUrl) {
            notify.onclick = () => {
              void trackEvent("notification_clicked", {
                source: "browser",
                streamer: name,
                milestone,
              });
              try {
                const tab = window.open(streamUrl, `runalert-stream-${name}`);
                tab?.focus?.();
              } catch {
                // ignore
              }
              try {
                notify.close();
              } catch {
                // ignore
              }
            };
          }
        } catch {
          // ignore
        }
        entry.milestones[milestone] = true;
        saveBrowserAlertDedupe();
      }
    }
  }

  async function sendTestNotification() {
    if (testStatus === "sending") return;
    setTestStatus("sending");
    try {
      await testNotify("runAlert test", "Agent is connected and ready.");
      setTestStatus("success");
      setTimeout(() => setTestStatus("idle"), 2500);
    } catch {
      setTestStatus("error");
      setTimeout(() => setTestStatus("idle"), 3500);
    }
  }

  function openQuietHoursEditor() {
    if (!cfg) {
      setErr("Config not loaded yet.");
      return;
    }
    const fromCfg = normalizeQuietHoursToArray(cfg.quietHours)
      .map(parseQuietRangeToDraft)
      .filter(Boolean) as QuietSpanDraft[];
    setQuietDraft(fromCfg.length ? fromCfg.slice(0, MAX_QUIET_SPANS) : []);
    setQuietErr(null);
    setShowQuietHours(true);
  }

  function validateQuietDraft(draft: QuietSpanDraft[]): {
    ok: boolean;
    ranges: string[];
    error?: string;
  } {
    const ranges: string[] = [];
    for (let i = 0; i < draft.length; i++) {
      const span = draft[i];
      const a = to24(span.start);
      const b = to24(span.end);
      if (!a || !b) {
        return {
          ok: false,
          ranges: [],
          error: `Quiet hours span ${i + 1} is incomplete or invalid.`,
        };
      }
      if (a.hh === b.hh && a.mm === b.mm) {
        return {
          ok: false,
          ranges: [],
          error: `Quiet hours span ${i + 1}: start and end cannot be the same.`,
        };
      }
      const start = `${pad2(a.hh)}:${pad2(a.mm)}`;
      const end = `${pad2(b.hh)}:${pad2(b.mm)}`;
      ranges.push(`${start}-${end}`);
    }
    return { ok: true, ranges };
  }

  function openAddStreamerPrompt() {
    if (cfg && (cfg.streamers ?? []).length >= MAX_STREAMERS) {
      setErr(
        `Max streamers reached (${MAX_STREAMERS}). Remove one to add more.`
      );
      return;
    }
    setAddStreamerErr(null);
    setAddStreamerName("");
    setShowAddStreamer(true);
  }

  async function submitAddStreamer() {
    setAddStreamerErr(null);
    const name = addStreamerName.trim();
    if (!name) {
      setAddStreamerErr("Streamer name cannot be empty.");
      return;
    }
    if (!cfg) {
      setAddStreamerErr("Config not loaded yet.");
      return;
    }
    if ((cfg.streamers ?? []).length >= MAX_STREAMERS) {
      setAddStreamerErr(
        `Max streamers reached (${MAX_STREAMERS}). Remove one to add more.`
      );
      return;
    }

    const exists = (cfg.streamers ?? []).some(
      (s) => s.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      setAddStreamerErr(`Streamer already exists: ${name}`);
      return;
    }

    // Optimistic UI update
    const optimistic: Config = structuredClone(cfg);
    optimistic.streamers = [...(optimistic.streamers ?? []), name];
    applyConfig(optimistic);
    setErr(null);

    // Close modal immediately for a snappy feel
    setShowAddStreamer(false);

    try {
      const saved = await putConfig(stripLegacyForsenConfig(optimistic));
      applyConfig(saved);
      void trackEvent("streamer_added", { streamer: name });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      // Roll back to canonical config if save fails
      try {
        const latest = await getConfig();
        applyConfig(latest);
      } catch {
        // keep existing error
      }
    }
  }

  async function removeStreamer(name: string) {
    if (!cfg) {
      setErr("Config not loaded yet.");
      return;
    }
    setPendingRemove(name);
    return;
  }

  async function confirmRemoveStreamer(name: string) {
    if (!cfg) {
      setErr("Config not loaded yet.");
      return;
    }

    // Optimistic UI update
    const optimistic: Config = structuredClone(cfg);
    optimistic.streamers = (optimistic.streamers ?? []).filter(
      (s) => s !== name
    );
    // Optionally delete the profile
    if (optimistic.profiles?.[name]) {
      delete optimistic.profiles[name];
    }
    applyConfig(optimistic);
    setErr(null);

    // Close the panel if this streamer was selected
    if (selected === name) {
      setSelected(null);
    }

    try {
      const saved = await putConfig(stripLegacyForsenConfig(optimistic));
      applyConfig(saved);
      void trackEvent("streamer_removed", { streamer: name });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      // Roll back to canonical config if save fails
      try {
        const latest = await getConfig();
        applyConfig(latest);
      } catch {
        // keep existing error
      }
    }
  }

  useEffect(() => {
    getConfig()
      .then(applyConfig)
      .catch((e) => setErr(e?.message ?? String(e)));
  }, []);

  useEffect(() => {
    if (desktopApp) {
      try {
        if (window.localStorage.getItem(APP_FIRST_OPENED_KEY) !== "true") {
          window.localStorage.setItem(APP_FIRST_OPENED_KEY, "true");
          void trackEvent("app_first_opened", { surface: "desktop" });
        }
        if (window.localStorage.getItem(DESKTOP_BG_RUNNING_KEY) !== "true") {
          window.localStorage.setItem(DESKTOP_BG_RUNNING_KEY, "true");
          void trackEvent("desktop_background_running", {
            surface: "desktop",
          });
        }
      } catch {
        void trackEvent("app_first_opened", { surface: "desktop" });
        void trackEvent("desktop_background_running", { surface: "desktop" });
      }
      return;
    }

    void trackEvent("browser_demo_opened", { surface: "browser" });
  }, [desktopApp]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true")
        return;
    } catch {
      // If storage is unavailable, show onboarding for the current session.
    }
    setShowOnboarding(true);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BROWSER_ALERTS_KEY);
      if (raw === "true") {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          setBrowserAlertsEnabled(true);
        } else if (
          typeof Notification !== "undefined" &&
          Notification.permission === "denied"
        ) {
          setBrowserAlertsErr(
            "Notifications are blocked in this browser. Enable them in browser settings."
          );
        }
      }
    } catch {
      // ignore
    }
    loadBrowserAlertDedupe();
  }, []);

  useEffect(() => {
    if (!selected || !anyMilestones) return;
    if (selected !== allToggleOwner) {
      setAllToggleOwner(selected);
      setAllToggleOn(allEnabled);
    }
  }, [selected, allEnabled, anyMilestones, allToggleOwner]);

  // (no inline toast fallback)

  // Fetch streamer profile info (avatar URLs). Cached heavily server-side.
  useEffect(() => {
    if (!cfg) return;
    const names = cfg?.streamers ?? [];
    void getProfiles(names)
      .then((r) => setProfileByName(r.profiles ?? {}))
      .catch(() => {
        // Best-effort: avatars are cosmetic.
      });
  }, [cfg]);

  // Poll streamer statuses for the streamer tile indicator (badge).
  useEffect(() => {
    if (!cfg) return;

    async function pollOnce() {
      const names = cfg?.streamers ?? [];
      const [runStatusResult, twitchStatusResult] = await Promise.allSettled([
        getStatuses(names),
        getTwitchStatuses(names),
      ]);

      if (runStatusResult.status === "fulfilled") {
        setStatusByName(runStatusResult.value.statuses ?? {});
        maybeSendBrowserAlerts(runStatusResult.value.statuses ?? {});
        setStatusErr(null);
      } else {
        // Best-effort: don't spam errors for status polling.
        setStatusErr(
          "Live status unavailable (restart watcher to update API)."
        );
      }

      if (twitchStatusResult.status === "fulfilled") {
        const next = twitchStatusResult.value.statuses ?? {};
        setTwitchStatusByName((prev) =>
          Object.keys(next).length ? next : prev
        );
      }
    }

    void pollOnce();

    if (statusPollRef.current) clearInterval(statusPollRef.current);
    // Shorter interval so the badge updates without requiring manual reloads.
    statusPollRef.current = setInterval(pollOnce, 5_000);

    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    };
  }, [cfg]);

  async function persistDraft(reason: "manual" | "autosave") {
    if (!cfg || !selected) return;

    // If a save is already in-flight, queue one more attempt (Enter should "eventually" win).
    if (saving) {
      queuedSaveRef.current = true;
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      const next = structuredClone(cfg);
      next.profiles = next.profiles || {};
      next.profiles[selected] = next.profiles[selected] || {};

      // Write milestone overrides into the profile
      for (const [milestone, mcfg] of Object.entries(draft)) {
        next.profiles[selected][milestone] = {
          ...next.profiles[selected][milestone],
          ...mcfg,
        };
      }

      const saved = await putConfig(stripLegacyForsenConfig(next));
      applyConfig(saved);
      void trackEvent("milestone_edited", {
        streamer: selected,
        reason,
      });
    } catch (e: any) {
      // If autosave fails, don't be noisy beyond showing the error; user can still hit Save.
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);

      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        // Fire-and-forget: run one more save with the latest draft.
        void persistDraft(reason);
      }
    }
  }

  useEffect(() => {
    if (!selected) return;
    hydratingDraftRef.current = true;
    setDraft(getMilestonesForStreamer(selected));
  }, [selected, cfg]);

  // Debounced autosave: whenever the user edits `draft`, persist after a short pause.
  useEffect(() => {
    if (!selected || !cfg) return;

    // Don't autosave when we are hydrating draft from config changes.
    if (hydratingDraftRef.current) {
      hydratingDraftRef.current = false;
      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void persistDraft("autosave");
    }, 700);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selected]);

  useEffect(() => {
    if (!dragCandidate && !dragState) return;

    function handlePointerMove(e: PointerEvent) {
      if (dragState) {
        setDragState((cur) =>
          cur
            ? {
                ...cur,
                x: e.clientX,
                y: e.clientY,
                insertIndex: getDragInsertIndex(
                  e.clientX,
                  e.clientY,
                  cur.index
                ),
              }
            : cur
        );
        return;
      }

      if (!dragCandidate) return;
      const moved = Math.hypot(
        e.clientX - dragCandidate.startX,
        e.clientY - dragCandidate.startY
      );
      if (moved < 8) return;

      suppressOpenRef.current = true;
      setDragState({
        index: dragCandidate.index,
        name: dragCandidate.name,
        x: e.clientX,
        y: e.clientY,
        offsetX: dragCandidate.offsetX,
        offsetY: dragCandidate.offsetY,
        width: dragCandidate.width,
        height: dragCandidate.height,
        insertIndex: getDragInsertIndex(
          e.clientX,
          e.clientY,
          dragCandidate.index
        ),
      });
      setDragCandidate(null);
    }

    function finishDrag() {
      setDragState((cur) => {
        if (cur) {
          reorderStreamers(cur.index, cur.insertIndex);
        }
        return null;
      });
      if (dragCandidate || dragState) {
        window.setTimeout(() => {
          suppressOpenRef.current = false;
        }, 0);
      }
      setDragCandidate(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragCandidate, dragState, streamers]);

  function getReorderedStreamers(
    fromIdx: number,
    insertIndex: number,
    names: string[]
  ) {
    const next = [...names];
    if (fromIdx < 0 || fromIdx >= next.length) return next;
    const clampedInsert = Math.max(0, Math.min(next.length, insertIndex));
    const targetIdx = clampedInsert > fromIdx ? clampedInsert - 1 : clampedInsert;
    if (targetIdx === fromIdx) return next;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    return next;
  }

  const reorderStreamers = (fromIdx: number, insertIndex: number) => {
    if (!cfg) return;
    const current = cfg.streamers ?? [];
    const next = getReorderedStreamers(fromIdx, insertIndex, current);
    if (next.every((name, idx) => name === current[idx])) return;
    const updated = { ...cfg, streamers: next };
    applyConfig(updated);
    void putConfig(stripLegacyForsenConfig(updated)).catch((e) =>
      setErr(e?.message ?? String(e))
    );
  };

  const quietHoursSummary = formatQuietHoursSummary(cfg?.quietHours);
  const desktopNotificationsSummary = notificationsEnabled ? "On" : "Off";
  const browserAlertsSummary = browserAlertsEnabled ? "On" : "Off";
  const backgroundSummary = backgroundMonitoringEnabled ? "On" : "Off";
  const installGuide = INSTALL_GUIDES[installGuidePlatform];
  const activeInstallStep = installGuide[installGuideStep] ?? installGuide[0];
  const guidePrimaryUrl =
    installGuidePlatform === "mac" ? macAppDownloadUrl : windowsAppDownloadUrl;
  const guidePrimaryLabel =
    installGuidePlatform === "mac" ? "Download DMG" : "Download EXE";

  function setTileRef(name: string, node: HTMLDivElement | null) {
    tileRefs.current[name] = node;
  }

  function getOrderedTileRects() {
    return streamers.map(
      (name) => tileRefs.current[name]?.getBoundingClientRect() ?? null
    );
  }

  function getDragInsertIndex(
    clientX: number,
    clientY: number,
    fallback: number
  ) {
    const rects = getOrderedTileRects();
    let bestIndex = fallback;
    let bestDistance = Number.POSITIVE_INFINITY;

    rects.forEach((rect, idx) => {
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = idx;
      }
    });

    const nearestRect = rects[bestIndex];
    if (!nearestRect) return fallback;
    const centerX = nearestRect.left + nearestRect.width / 2;
    const centerY = nearestRect.top + nearestRect.height / 2;
    const before =
      Math.abs(clientY - centerY) > Math.abs(clientX - centerX)
        ? clientY < centerY
        : clientX < centerX;
    const rawInsertIndex = before ? bestIndex : bestIndex + 1;
    return Math.max(0, Math.min(streamers.length, rawInsertIndex));
  }

  function getTilePreviewStyle(
    name: string,
    idx: number
  ): React.CSSProperties | undefined {
    if (!dragState || idx === dragState.index) return undefined;

    const rects = getOrderedTileRects();
    const sourceRect = rects[idx];
    if (!sourceRect) return undefined;

    const previewNames = getReorderedStreamers(
      dragState.index,
      dragState.insertIndex,
      streamers
    );
    const previewIndex = previewNames.indexOf(name);
    const targetRect = rects[previewIndex];
    if (!targetRect) return undefined;

    const dx = targetRect.left - sourceRect.left;
    const dy = targetRect.top - sourceRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return undefined;

    return {
      transform: `translate(${dx}px, ${dy}px)`,
      zIndex: 3,
    };
  }

  function beginPointerDrag(
    e: React.PointerEvent<HTMLButtonElement>,
    index: number,
    name: string
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragCandidate({
      index,
      name,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  function getNetherCutoffSec(name: string): number | null {
    if (!cfg) return null;

    const profile = cfg.profiles?.[name];
    const profileNether = profile?.nether?.thresholdSec;
    if (typeof profileNether === "number") return profileNether;

    const defaultNether = cfg.defaultMilestones?.nether?.thresholdSec;
    return typeof defaultNether === "number" ? defaultNether : null;
  }

  function getMilestonesForStreamer(
    name: string
  ): Record<string, MilestoneCfg> {
    if (!cfg) return {};

    const defaults = cfg.defaultMilestones ?? {};
    const profile = cfg.profiles?.[name] ?? {};

    const out: Record<string, MilestoneCfg> = {};

    // Canonical list first (so UI shows consistent milestones even if config is sparse)
    for (const milestone of CANONICAL_MILESTONES) {
      const base = defaults[milestone] ?? {};
      const override = profile[milestone] ?? {};
      const merged: MilestoneCfg = { ...base, ...override };

      // If nothing is configured anywhere, default to disabled for that milestone
      if (merged.enabled == null && merged.thresholdSec == null) {
        merged.enabled = false;
      }

      out[milestone] = merged;
    }

    // Include any profile-only milestones (future-proof)
    for (const [milestone, override] of Object.entries(profile)) {
      if (!out[milestone]) out[milestone] = { ...override };
    }

    return out;
  }

  function openInstallGuide(platform: InstallGuidePlatform) {
    setInstallGuidePlatform(platform);
    setInstallGuideStep(0);
    setShowInstallDetails(true);
    void trackEvent("help_opened", {
      surface: "download-hub",
      platform,
    });
  }

  function milestoneBadgeText(milestone: string): string {
    switch (milestone) {
      case "nether":
        return "Nether";
      case "bastion":
        return "Bastion";
      case "fortress":
        return "Fortress";
      case "first_portal":
        return "1st Portal";
      case "stronghold":
        return "Stronghold";
      case "end":
        return "End";
      case "finish":
        return "Finish";
      default:
        return String(milestone);
    }
  }

  function milestoneEmoji(milestone: string): string | null {
    switch (milestone) {
      case "nether":
        return "🔥";
      case "bastion":
        return "🟨🐷";
      case "fortress":
        return "🏰🧱";
      case "first_portal":
        return "🌀✨";
      case "stronghold":
        return "👁️";
      case "end":
        return "🐉";
      case "finish":
        return "👑";
      default:
        return null;
    }
  }

  function milestoneEnteredLabel(milestone: string): string {
    const label = milestoneBadgeText(milestone);
    if (milestone === "first_portal") return label;
    if (milestone === "finish") return label;
    return `Entered ${label}`;
  }

  function formatRunTime(ms?: number | null): string | null {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatAgo(sec?: number | null): string | null {
    if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
    if (sec < 60) return `${Math.floor(sec)}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    const rem = min % 60;
    if (hr < 24) return `${hr}h ${rem}m ago`;
    const days = Math.floor(hr / 24);
    const remH = hr % 24;
    return remH > 0 ? `${days}d ${remH}h ago` : `${days}d ago`;
  }

  function getBadgeData(name: string): {
    milestone: string;
    ms?: number | null;
    updatedSec?: number | null;
    className: "final" | "live";
  } | null {
    const s = statusByName[name];
    if (!s) return null;

    // Finish grace: if previous run finished very recently but a new run started,
    // show a gold Finish badge for a short window.
    if (s.recentFinishMs != null) {
      return {
        milestone: "finish",
        ms: s.recentFinishMs,
        updatedSec: s.recentFinishUpdatedSec,
        className: "final",
      };
    }

    // Only show badges for runners that are "active on paceman" recently.
    if (s.isActive !== true) return null;

    if (!s.lastMilestone) return null;
    return {
      milestone: s.lastMilestone,
      ms: s.lastMilestoneMs,
      updatedSec: s.lastUpdatedSec,
      className: s.lastMilestone === "finish" ? "final" : "live",
    };
  }

  function badgeTitleFor(name: string): string {
    const s = statusByName[name];
    const badge = getBadgeData(name);
    if (!s || !badge) return "";

    const label = milestoneBadgeText(badge.milestone);
    const split = formatRunTime(badge.ms);

    // Primary "ago" signal: Paceman updateTime bumps when new split data is recorded.
    const nowSec = Math.floor(Date.now() / 1000);
    const agoFromUpdate =
      typeof badge.updatedSec === "number" && Number.isFinite(badge.updatedSec)
        ? formatAgo(Math.max(0, nowSec - badge.updatedSec))
        : null;

    // Fallback: approximate "when did this milestone happen" from insertTime + split.
    const milestoneAtSec =
      typeof s.runStartSec === "number" &&
      Number.isFinite(s.runStartSec) &&
      typeof badge.ms === "number" &&
      Number.isFinite(badge.ms)
        ? s.runStartSec + Math.floor(badge.ms / 1000)
        : null;
    const agoFromRunStart =
      typeof milestoneAtSec === "number"
        ? formatAgo(Math.max(0, nowSec - milestoneAtSec))
        : null;

    const ago = agoFromUpdate ?? agoFromRunStart;
    return [`${label}${split ? `: ${split}` : ""}`, ago]
      .filter(Boolean)
      .join(" • ");
  }

  function subtitleFor(name: string): string | null {
    const s = statusByName[name];
    const badge = getBadgeData(name);
    if (!s) return null;
    if (badge) return badgeTitleFor(name);

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof s.lastUpdatedSec === "number") {
      const ago = formatAgo(Math.max(0, nowSec - s.lastUpdatedSec));
      return ago ? `Last update • ${ago}` : null;
    }
    return null;
  }

  return (
    <div className="page">
      <div className="frame" data-testid="header-frame">
        <div className="titleRow" data-testid="header-titleRow">
          <div className="titleLeft">
            <div className="brandRow" data-testid="header-brandRow">
              <div
                className="brandArtSlot"
                data-testid="header-artSlot"
                aria-hidden="true"
              >
                <span className="titleDragon" data-testid="header-dragon" />
              </div>
              <div className="brandText">
                <div className="titleLine">
                  <h1 className="appTitle" data-testid="header-title">
                    Minecraft Speedrun Notifier
                  </h1>
                  <div className="metaRow" data-testid="header-meta">
                    <a
                      className="tag"
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {APP_CHANNEL}
                    </a>
                    <span className="metaWarn">⚠ Possible bugs</span>
                  </div>
                </div>
                <div className="utilityRow" data-testid="header-utilityRow">
                  {desktopApp ? (
                    <>
                      <div className="utilityCard" data-testid="header-notifications">
                        <button
                          type="button"
                          className="utilityMain"
                          onClick={() => setShowNotifications(true)}
                          aria-label="Open notifications settings"
                        >
                          <span className="utilityEyebrow">Notifications</span>
                          <span className="utilityValue">
                            {desktopNotificationsSummary}
                          </span>
                        </button>
                        <div className="utilityActions">
                          <button
                            type="button"
                            className={`utilityIconBtn ${
                              notificationsEnabled ? "on" : "off"
                            }`}
                            aria-label={
                              notificationsEnabled
                                ? "Disable notifications"
                                : "Enable notifications"
                            }
                            onClick={() =>
                              toggleNotificationsEnabled(!notificationsEnabled)
                            }
                          >
                            {notificationsEnabled ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                            )}
                          </button>
                          <button
                            type="button"
                            className={`utilityIconBtn ${
                              notificationSoundEnabled ? "on" : "off"
                            }`}
                            aria-label={
                              notificationSoundEnabled
                                ? "Turn notification sound off"
                                : "Turn notification sound on"
                            }
                            onClick={() =>
                              toggleNotificationSound(!notificationSoundEnabled)
                            }
                          >
                            {notificationSoundEnabled ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="utilityCard">
                        <button
                          type="button"
                          className="utilityMain"
                          onClick={openQuietHoursEditor}
                          aria-label="Edit quiet hours"
                          data-testid="header-quietHours"
                          title="During quiet hours, runAlert keeps monitoring but does not send notifications."
                        >
                          <span className="utilityEyebrow">Quiet Hours</span>
                          <span className="utilityValue">{quietHoursSummary}</span>
                        </button>
                        <div className="utilityActions">
                          <button
                            type="button"
                            className={`utilityIconBtn ${quietHoursSummary !== "None" ? "moon-on" : "moon-off"}`}
                            aria-label="Edit quiet hours"
                            onClick={openQuietHoursEditor}
                          >
                            {quietHoursSummary !== "None" ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="utilityCard" data-testid="header-background">
                        <button
                          type="button"
                          className="utilityMain"
                          onClick={() => setShowAgentSettings(true)}
                          aria-label="Open background monitoring settings"
                        >
                          <span className="utilityEyebrow">Background Monitoring</span>
                          <span className="utilityValue">{backgroundSummary}</span>
                        </button>
                        <div className="utilityActions">
                          <button
                            type="button"
                            className={`utilityIconBtn ${
                              backgroundMonitoringEnabled
                                ? "radar-on"
                                : "radar-off"
                            }`}
                            aria-label={
                              backgroundMonitoringEnabled
                                ? "Disable background monitoring"
                                : "Enable background monitoring"
                            }
                            onClick={() =>
                              updateBackgroundMonitoring(!backgroundMonitoringEnabled)
                            }
                          >
                            {backgroundMonitoringEnabled ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/><path d="M12 2.5A9.5 9.5 0 0 1 21.5 12"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 4.5A7.5 7.5 0 0 1 19.5 12"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="utilityCard" data-testid="header-browserAlerts">
                        <button
                          type="button"
                          className="utilityMain"
                          onClick={() =>
                            browserAlertsEnabled
                              ? disableBrowserAlerts()
                              : enableBrowserAlerts()
                          }
                          aria-label={
                            browserAlertsEnabled
                              ? "Disable browser alerts"
                              : "Enable browser alerts"
                          }
                        >
                          <span className="utilityEyebrow">Browser Alerts</span>
                          <span className="utilityValue">
                            {browserAlertsSummary}
                          </span>
                        </button>
                        <div className="utilityActions">
                          <button
                            type="button"
                            className={`utilityIconBtn ${
                              browserAlertsEnabled ? "on" : "off"
                            }`}
                            aria-label={
                              browserAlertsEnabled
                                ? "Disable browser alerts"
                                : "Enable browser alerts"
                            }
                            onClick={() =>
                              browserAlertsEnabled
                                ? disableBrowserAlerts()
                                : enableBrowserAlerts()
                            }
                          >
                            {browserAlertsEnabled ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                            )}
                          </button>
                          <button
                            type="button"
                            className={`utilityIconBtn ${
                              notificationSoundEnabled ? "on" : "off"
                            }`}
                            aria-label={
                              notificationSoundEnabled
                                ? "Turn notification sound off"
                                : "Turn notification sound on"
                            }
                            onClick={() =>
                              toggleNotificationSound(!notificationSoundEnabled)
                            }
                          >
                            {notificationSoundEnabled ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="utilityCard">
                        <button
                          type="button"
                          className="utilityMain"
                          onClick={openQuietHoursEditor}
                          aria-label="Edit quiet hours"
                          data-testid="header-quietHours"
                          title="During quiet hours, runAlert keeps monitoring but does not send notifications."
                        >
                          <span className="utilityEyebrow">Quiet Hours</span>
                          <span className="utilityValue">{quietHoursSummary}</span>
                        </button>
                        <div className="utilityActions">
                          <button
                            type="button"
                            className={`utilityIconBtn ${quietHoursSummary !== "None" ? "moon-on" : "moon-off"}`}
                            aria-label="Edit quiet hours"
                            onClick={openQuietHoursEditor}
                          >
                            {quietHoursSummary !== "None" ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                </div>
              </div>
            {statusErr ? (
              <div className="statusWarn">
                {statusErr}
              </div>
            ) : null}
          </div>

          <button
            className="iconBtn settingsGear"
            aria-label="Open settings"
            onClick={() => setShowSettings(true)}
          >
            <svg
              className="iconSvg gear"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.56ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
              />
            </svg>
          </button>
        </div>

        {err ? (
          <div className="configError">{err}</div>
        ) : null}
        {!cfg ? (
          <div className="loadingText">Loading config…</div>
        ) : null}

        {selected && cfg ? (
          <div className="qhOverlay" onClick={() => setSelected(null)}>
          <div className="milestonePanel" onClick={(e) => e.stopPropagation()}>
            <div className="milestonePanelHeader">
              <a
                className={`label labelLink labelRow panelName ${
                  isStreamerLive(selected) ? "labelLive" : ""
                }`}
                href={getTwitchUrl(selected) ?? undefined}
                target="_blank"
                rel="noreferrer"
                title="Open stream"
              >
                <span>{selected}</span>
                {isStreamerLive(selected) ? (
                  <span
                    className="liveDot on"
                    aria-label="Live on Twitch"
                    title="Live on Twitch"
                  />
                ) : null}
              </a>
              <div className="milestonePanelActions">
                <button
                  type="button"
                  className="removeStreamerBtn"
                  aria-label="Remove streamer"
                  title="Remove streamer"
                  onClick={() => removeStreamer(selected)}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M4.5 2H11.5M2 4H14M12.667 4L12.111 12.067C12.048 12.956 11.296 13.667 10.405 13.667H5.595C4.704 13.667 3.952 12.956 3.889 12.067L3.333 4M6.333 7.333V10.667M9.667 7.333V10.667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="closeStreamerBtn"
                  aria-label="Close"
                  onClick={() => setSelected(null)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="driftNote">
              <a
                href="https://paceman.gg/"
                target="_blank"
                rel="noreferrer"
              >
                Paceman
              </a>{" "}
              split times can drift vs real IGT. Add a small buffer to your
              thresholds for safety.
            </div>

            <div className="milestoneAllRow">
              <span className="milestoneAllLabel">All milestones</span>
              <label className="milestoneAllToggle">
                <input
                  type="checkbox"
                  checked={allToggleOn}
                  disabled={!anyMilestones}
                  onChange={(e) => {
                    if (!anyMilestones) return;
                    const nextEnabled = e.target.checked;
                    setAllToggleOn(nextEnabled);
                    setDraft((d) => {
                      const next = { ...d };
                      for (const key of Object.keys(next)) {
                        next[key] = { ...next[key], enabled: nextEnabled };
                      }
                      return next;
                    });
                  }}
                />
              </label>
            </div>

            <div className="milestoneGrid">
              {Object.entries(draft).map(([milestone, mcfg]) => {
                const enabled = mcfg.enabled ?? true;
                const value = mcfg.thresholdSec;
                const { mm, ss } = splitMMSS(
                  typeof value === "number" ? value : undefined
                );

                return (
                  <div
                    key={milestone}
                    className="milestoneRow"
                    style={{ opacity: enabled ? 1 : 0.55 }}
                  >
                    <div className="milestoneLabel">
                      {milestoneLabel(milestone)}
                    </div>

                    <div className="milestoneControls">
                      <div className="timeInputs">
                        <span className="timePrefix">&le;</span>

                        <input
                          type="number"
                          aria-label={`${milestone}-minutes`}
                          value={mm}
                          placeholder="0"
                          min={0}
                          step={1}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const cur = draft[milestone]?.thresholdSec;
                            const curMm =
                              typeof cur === "number"
                                ? Math.floor(cur / 60)
                                : 0;
                            const curSs =
                              typeof cur === "number" ? cur % 60 : 0;

                            const nextMm =
                              raw === ""
                                ? undefined
                                : clampInt(Number(raw), 0, 9999);
                            const nextSec =
                              nextMm == null && raw === "" && ss === ""
                                ? undefined
                                : (nextMm ?? curMm) * 60 + curSs;

                            setDraft((d) => ({
                              ...d,
                              [milestone]: {
                                ...d[milestone],
                                thresholdSec: nextSec,
                              },
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (autosaveTimerRef.current)
                              clearTimeout(autosaveTimerRef.current);
                            autosaveTimerRef.current = null;
                            void persistDraft("manual");
                          }}
                          className="timeField"
                        />
                        <span className="timeUnit">m</span>

                        <span className="timeColon">:</span>

                        <input
                          type="number"
                          aria-label={`${milestone}-seconds`}
                          value={ss}
                          placeholder="00"
                          min={0}
                          max={59}
                          step={1}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const cur = draft[milestone]?.thresholdSec;
                            const curMm =
                              typeof cur === "number"
                                ? Math.floor(cur / 60)
                                : 0;

                            const nextSs =
                              raw === ""
                                ? undefined
                                : clampInt(Number(raw), 0, 59);
                            const nextSec =
                              nextSs == null && raw === "" && mm === ""
                                ? undefined
                                : curMm * 60 + (nextSs ?? 0);

                            setDraft((d) => ({
                              ...d,
                              [milestone]: {
                                ...d[milestone],
                                thresholdSec: nextSec,
                              },
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (autosaveTimerRef.current)
                              clearTimeout(autosaveTimerRef.current);
                            autosaveTimerRef.current = null;
                            void persistDraft("manual");
                          }}
                          className="timeField"
                        />
                        <span className="timeUnit">s</span>
                      </div>

                      <label className="milestoneToggle">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setDraft((d) => ({
                              ...d,
                              [milestone]: { ...d[milestone], enabled: on },
                            }));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="milestonePanelFooter">
              <button
                onClick={() => {
                  if (!selected) return;
                  setDraft(getMilestonesForStreamer(selected)); // revert
                }}
                className="modalBtn"
              >
                Cancel
              </button>

              <button
                disabled={!cfg || !selected || saving || milestoneSaved}
                onClick={async () => {
                  if (autosaveTimerRef.current)
                    clearTimeout(autosaveTimerRef.current);
                  autosaveTimerRef.current = null;
                  await persistDraft("manual");
                  if (milestoneSavedTimerRef.current) {
                    window.clearTimeout(milestoneSavedTimerRef.current);
                  }
                  setMilestoneSaved(true);
                  milestoneSavedTimerRef.current = window.setTimeout(() => {
                    setMilestoneSaved(false);
                    milestoneSavedTimerRef.current = null;
                  }, 1200);
                }}
                className={`modalBtn modalBtn--save${
                  milestoneSaved ? " saved" : ""
                }`}
              >
                {milestoneSaved ? (
                  <>
                    <svg
                      className="savedCheck"
                      viewBox="0 0 14 14"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 7.5L5.5 10.5L11.5 4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                    Saved
                  </>
                ) : saving ? (
                  "Saving…"
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
          </div>
        ) : null}

        <div className="grid">
          {streamers.map((name, idx) => (
            <div
              className={`avatarTile${
                dragState?.index === idx ? " dragOrigin" : ""
              }`}
              key={name}
              ref={(node) => setTileRef(name, node)}
              style={getTilePreviewStyle(name, idx)}
            >
              <button
                className="avatarBtn"
                type="button"
                draggable={false}
                onPointerDown={(e) => beginPointerDrag(e, idx, name)}
                onClick={() => {
                  if (suppressOpenRef.current || dragCandidate || dragState)
                    return;
                  setSelected(name);
                }}
              >
                {getAvatarSrc(name) ? (
                  <img
                    className="avatarImg"
                    alt={`${name} avatar`}
                    src={getAvatarSrc(name)!}
                    loading="lazy"
                    draggable={false}
                  />
                ) : null}
              </button>
              {getBadgeData(name) ? (
                <span
                  className={`milestoneBadge ${getBadgeData(name)!.className}`}
                  aria-label={`${name}-milestone`}
                  title={badgeTitleFor(name)}
                >
                  {milestoneBadgeText(getBadgeData(name)!.milestone)}
                </span>
              ) : null}
              <a
                className={`label labelLink labelRow ${
                  isStreamerLive(name) ? "labelLive" : ""
                }`}
                href={getTwitchUrl(name) ?? undefined}
                target="_blank"
                rel="noreferrer"
                title="Open stream"
              >
                <span>{name}</span>
                {isStreamerLive(name) ? (
                  <span
                    className="liveDot on"
                    aria-label="Live on Twitch"
                    title="Live on Twitch"
                  />
                ) : null}
              </a>
              <a
                className="milestoneSubtitle milestoneLink"
                href={getPacemanStatsUrl(name) ?? undefined}
                target="_blank"
                rel="noreferrer"
                title="Open stats"
              >
                {subtitleFor(name) ?? "Last update • —"}
              </a>
            </div>
          ))}

          <div className="avatarTile addTile">
            <button className="avatarBtn add" onClick={openAddStreamerPrompt}>
              <svg className="addPlus" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"
                />
              </svg>
            </button>
            <div className="label">Add Streamer</div>
          </div>
        </div>

        {dragState ? (
          <div
            className="avatarDragOverlay"
            style={{
              transform: `translate(${dragState.x - dragState.offsetX}px, ${dragState.y - dragState.offsetY}px)`,
              width: dragState.width,
            }}
          >
            <div
              className="avatarBtn"
              style={{ width: dragState.width, height: dragState.height }}
            >
              {getAvatarSrc(dragState.name) ? (
                <img
                  className="avatarImg"
                  alt={`${dragState.name} avatar`}
                  src={getAvatarSrc(dragState.name)!}
                  loading="lazy"
                  draggable={false}
                />
              ) : null}
            </div>
            {getBadgeData(dragState.name) ? (
              <span
                className={`milestoneBadge ${
                  getBadgeData(dragState.name)!.className
                }`}
                aria-hidden="true"
              >
                {milestoneBadgeText(getBadgeData(dragState.name)!.milestone)}
              </span>
            ) : null}
            <div className="label">{dragState.name}</div>
            <div className="milestoneSubtitle">
              {subtitleFor(dragState.name) ?? "Last update • —"}
            </div>
          </div>
        ) : null}

        <div className="bottomSpacer" />

        {!desktopApp ? (
          <div className="downloadHub" aria-label="Desktop app downloads">
            <div className="downloadHubHeader">
              <div className="downloadHubTitle">Desktop app</div>
              <div className="downloadHubText">
                Get background alerts even when closed.
              </div>
            </div>
            <div className="downloadHubActions">
              <button
                className="installButton installButton--primary"
                type="button"
                onClick={() => {
                  openInstallGuide("mac");
                }}
              >
                <svg width="14" height="14" viewBox="0 0 384 512" fill="currentColor" style={{marginRight: 6, flexShrink: 0}}>
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                </svg>
                Download Mac Beta
              </button>
              <button
                className="installButton installButton--primary"
                type="button"
                onClick={() => {
                  openInstallGuide("windows");
                }}
              >
                <svg width="14" height="14" viewBox="0 0 448 512" fill="currentColor" style={{marginRight: 6, flexShrink: 0}}>
                  <path d="M0 93.7l183.6-25.3v177.4H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-380.6v180.1H448V32L203.8 65.7z"/>
                </svg>
                Download Windows Beta
              </button>
            </div>
            {browserAlertsErr ? (
              <div className="alertsError downloadHubError">{browserAlertsErr}</div>
            ) : null}
          </div>
        ) : null}

        <div className="creditRow">
          <span className="creditText">Powered by</span>{" "}
          <a
            className="creditLink"
            href="https://paceman.gg"
            target="_blank"
            rel="noreferrer"
          >
            paceman.gg
          </a>
        </div>
        <div className="pageVersion">v{APP_VERSION}</div>

        {showOnboarding ? (
          <div className="qhOverlay" onClick={dismissOnboarding}>
            <div
              className="qhModal qhModal--sm"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Welcome to runAlert"
            >
              <div className="qhHeader">
                <div>
                  <div className="qhTitle">Welcome to runAlert</div>
                  <div className="qhHelp">
                    Add streamers, set pace thresholds, and get notified when a
                    run becomes worth watching.
                  </div>
                </div>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close onboarding"
                  onClick={dismissOnboarding}
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>
              <div className="onboardingGrid">
                {desktopApp ? (
                  <>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">Add streamers</div>
                      <div className="onboardingStepText">
                        Pick the runners you want to watch.
                      </div>
                    </div>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">Allow notifications</div>
                      <div className="onboardingStepText">
                        So runAlert can alert you when a run matters.
                      </div>
                    </div>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">
                        Optional: Background Monitoring
                      </div>
                      <div className="onboardingStepText">
                        Want seamless alerts without reopening runAlert? Turn this on.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">Add streamers</div>
                      <div className="onboardingStepText">
                        Pick the runners you want to watch.
                      </div>
                    </div>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">Turn on browser alerts</div>
                      <div className="onboardingStepText">
                        Allow alerts in this browser.
                      </div>
                    </div>
                    <div className="onboardingStep">
                      <div className="onboardingStepTitle">Keep this tab open</div>
                      <div className="onboardingStepText">
                        Browser alerts work while this page stays open.
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="promptActions">
                <button
                  type="button"
                  className="qhSave"
                  onClick={dismissOnboarding}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showInstallDetails ? (
          <div
            className="qhOverlay"
            onClick={() => setShowInstallDetails(false)}
          >
            <div
              className="qhModal installGuideModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Install help"
            >
              <div className="qhHeader">
                <div>
                  <div className="qhTitle">
                    {installGuidePlatform === "mac"
                      ? "Install runAlert on Mac"
                      : "Install runAlert on Windows"}
                  </div>
                  <div className="qhHelp">
                    Follow these steps to get started.
                  </div>
                </div>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close help"
                  onClick={() => setShowInstallDetails(false)}
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>

              <div className="installGuideShell">
                <div className="installGuideTabs" role="tablist" aria-label="Install platform">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={installGuidePlatform === "mac"}
                    className={`installGuideTab ${
                      installGuidePlatform === "mac" ? "active" : ""
                    }`}
                    onClick={() => {
                      setInstallGuidePlatform("mac");
                      setInstallGuideStep(0);
                    }}
                  >
                    Mac
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={installGuidePlatform === "windows"}
                    className={`installGuideTab ${
                      installGuidePlatform === "windows" ? "active" : ""
                    }`}
                    onClick={() => {
                      setInstallGuidePlatform("windows");
                      setInstallGuideStep(0);
                    }}
                  >
                    Windows
                  </button>
                </div>

                <div className="installGuideStepMeta">
                  {installGuide.map((_, i) => (
                    <span
                      key={i}
                      className={`installGuideDot${i === installGuideStep ? " active" : ""}`}
                    />
                  ))}
                </div>

                <div className="installGuidePanel">
                  {activeInstallStep.imageSrc ? (
                    <div className="installGuideShotFrame">
                      <img
                        className="installGuideShot"
                        src={activeInstallStep.imageSrc}
                        alt={activeInstallStep.imageAlt}
                        loading="lazy"
                      />
                    </div>
                  ) : null}

                  <div className="installGuideCopy">
                    <div className="installGuideTitle">
                      {activeInstallStep.title}
                    </div>
                    <div className="installGuideBody">
                      {activeInstallStep.body}
                    </div>
                    {activeInstallStep.details?.length ? (
                      <ul className="installGuideList">
                        {activeInstallStep.details.map((detail, idx) => (
                          <li key={idx}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                    {activeInstallStep.note ? (
                      <div className="installGuideNote">
                        {activeInstallStep.note}
                      </div>
                    ) : null}

                    {installGuideStep === 0 ? (
                      <div className="installGuideActions">
                        <a
                          className="installButton installButton--primary"
                          href={guidePrimaryUrl}
                          onClick={() =>
                            void trackEvent("app_download_clicked", {
                              platform: installGuidePlatform,
                              action:
                                installGuidePlatform === "mac"
                                  ? "download_dmg"
                                  : "download_exe",
                            })
                          }
                        >
                          {guidePrimaryLabel}
                        </a>
                        {installGuidePlatform === "mac" ? (
                          <a
                            className="installButton"
                            href={macAppZipUrl}
                            onClick={() =>
                              void trackEvent("app_download_clicked", {
                                platform: "mac",
                                action: "download_zip",
                              })
                            }
                          >
                            Download ZIP
                          </a>
                        ) : null}
                        <a
                          className="installLink"
                          href={GITHUB_BETA_RELEASE_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View release + checksums
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="installGuideFooter">
                  <button
                    type="button"
                    className="installButton"
                    onClick={() =>
                      setInstallGuideStep((step) => Math.max(0, step - 1))
                    }
                    disabled={installGuideStep === 0}
                  >
                    Back
                  </button>
                  <div className="installGuideFooterActions">
                    {installGuideStep < installGuide.length - 1 ? (
                      <button
                        type="button"
                        className="installButton installButton--primary"
                        onClick={() =>
                          setInstallGuideStep((step) =>
                            Math.min(installGuide.length - 1, step + 1)
                          )
                        }
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="installButton installButton--primary"
                        onClick={() => setShowInstallDetails(false)}
                      >
                        Done
                      </button>
                    )}
                  </div>
                </div>

                <details className="installGuideAdvanced">
                  <summary>Need advanced install tools?</summary>
                  <div className="installGuideAdvancedBody">
                    <div className="installSteps">
                      Fallback scripts clone the public runAlert repo and run
                      the watcher directly. Keep them for advanced testing only.
                    </div>
                    <div className="installCommandRow">
                      <button
                        className="installCopy"
                        type="button"
                        onClick={() => {
                          void trackEvent("app_download_clicked", {
                            platform: "mac",
                            action: "copy_command",
                          });
                          copyInstallCommand(macInstallCommand, "mac");
                        }}
                      >
                        {installCopied === "mac"
                          ? "Copied"
                          : "Copy macOS command"}
                      </button>
                      <span className="installCommandHint">
                        Bash installer (macOS)
                      </span>
                    </div>
                    <div className="installCommand">{macInstallCommand}</div>
                    <div className="installCommandRow">
                      <button
                        className="installCopy"
                        type="button"
                        onClick={() => {
                          void trackEvent("app_download_clicked", {
                            platform: "windows",
                            action: "copy_command",
                          });
                          copyInstallCommand(windowsInstallCommand, "windows");
                        }}
                      >
                        {installCopied === "windows"
                          ? "Copied"
                          : "Copy Windows command"}
                      </button>
                      <span className="installCommandHint">
                        PowerShell installer (Windows)
                      </span>
                    </div>
                    <div className="installCommand">{windowsInstallCommand}</div>
                    <div className="installGuideAdvancedLinks">
                      <a
                        className="installLink"
                        href={macViewInstallUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View macOS watcher script
                      </a>
                      <a
                        className="installLink"
                        href={windowsViewInstallUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View Windows watcher script
                      </a>
                    </div>
                    <div className="installTestRow">
                      <button
                        className="installTest"
                        type="button"
                        onClick={sendTestNotification}
                        disabled={testStatus === "sending"}
                      >
                        {testStatus === "sending"
                          ? "Sending…"
                          : "Send test notification"}
                      </button>
                      <span className="installTestHint">
                        {testStatus === "success"
                          ? "Sent! Check your desktop notifications."
                          : testStatus === "error"
                            ? "No agent detected yet."
                            : "Use this after install to verify it works."}
                      </span>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        ) : null}

        {showSettings ? (
          <div
            className="settingsOverlay"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="settingsPanel"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="settingsHeader">
                <div className="settingsTitle">Settings</div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="iconBtn iconBtn--close"
                  aria-label="Close settings"
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>

              <div className="settingsMenu">
                <button
                  className="settingsMenuBtn"
                  onClick={() => {
                    setShowSettings(false);
                    setShowNotifications(true);
                  }}
                >
                  Notifications
                </button>
                <button
                  className="settingsMenuBtn"
                  onClick={() => {
                    setShowSettings(false);
                    openQuietHoursEditor();
                  }}
                >
                  Quiet Hours
                </button>
                <button
                  className="settingsMenuBtn"
                  onClick={() => {
                    setShowSettings(false);
                    setShowAgentSettings(true);
                  }}
                >
                  Background Monitoring
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showNotifications ? (
          <div
            className="qhOverlay settingsSubOverlay"
            onClick={() => setShowNotifications(false)}
          >
            <div
              className="qhModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Notifications"
            >
              <div className="settingsSubHeader">
                <button
                  type="button"
                  className="settingsBackBtn"
                  aria-label="Back to settings"
                  onClick={() => {
                    setShowNotifications(false);
                    setShowSettings(true);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Settings
                </button>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close notifications"
                  onClick={() => setShowNotifications(false)}
                >
                  <svg className="iconSvg close" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
                  </svg>
                </button>
              </div>
              <div className="settingsSubTitle">Notifications</div>
              <div className="settingsSubHelp">
                {desktopApp
                  ? "Control whether runAlert sends alerts, plays sound, and works with macOS notification settings."
                  : "Control whether runAlert shows browser alerts and plays the alert sound while this tab stays open."}
              </div>

              <div className="notifBody">
                <label className="notifRow">
                  <span>Enable notifications</span>
                  <input
                    type="checkbox"
                    checked={notificationsEnabled}
                    onChange={(e) =>
                      toggleNotificationsEnabled(e.target.checked)
                    }
                  />
                </label>
                <label className="notifRow">
                  <span>Notification sound</span>
                  <input
                    type="checkbox"
                    checked={notificationSoundEnabled}
                    disabled={!notificationsEnabled}
                    onChange={(e) => toggleNotificationSound(e.target.checked)}
                  />
                </label>
                {desktopApp ? (
                  <div className="notifSection">
                    <div className="notifSectionTitle">macOS controls the rest</div>
                    <div className="notifNote">
                      Banner style, lock screen, notification center, badges,
                      sound, previews, and grouping all live in macOS Settings
                      → Notifications → runAlert.
                    </div>
                    <img
                      className="notifPreviewShot"
                      src="/install-guide/step-5-notification-settings.png"
                      alt="macOS notification settings for runAlert"
                      loading="lazy"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showAgentSettings ? (
          <div className="qhOverlay settingsSubOverlay" onClick={() => setShowAgentSettings(false)}>
            <div
              className="qhModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Background monitoring"
            >
              <div className="settingsSubHeader">
                <button
                  type="button"
                  className="settingsBackBtn"
                  aria-label="Back to settings"
                  onClick={() => {
                    setShowAgentSettings(false);
                    setShowSettings(true);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Settings
                </button>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close background monitoring settings"
                  onClick={() => setShowAgentSettings(false)}
                >
                  <svg className="iconSvg close" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
                  </svg>
                </button>
              </div>
              <div className="settingsSubTitle">Background Monitoring</div>
              <div className="settingsSubHelp">
                Keep runAlert in the background for seamless alerts, even
                after sleep or restart.
              </div>

              <div className="notifBody">
                <label className="notifRow">
                  <span>Enable background monitoring</span>
                  <input
                    type="checkbox"
                    checked={backgroundMonitoringEnabled}
                    onChange={(e) => {
                      updateBackgroundMonitoring(e.target.checked);
                    }}
                  />
                </label>
                <div className="notifNote">
                  If you quit runAlert, this stops until you open it again.
                </div>
                <label className="notifRow">
                  <span>Auto‑update agent on launch</span>
                  <input
                    type="checkbox"
                    checked={agentAutoUpdateEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (!cfg) return;
                      const updated = structuredClone(cfg);
                      updated.agent = {
                        ...(updated.agent || {}),
                        autoUpdate: next,
                        backgroundMonitoring: backgroundMonitoringEnabled,
                      };
                      applyConfig(updated);
                      setErr(null);
                      void putConfig(stripLegacyForsenConfig(updated)).catch((e) =>
                        setErr(e?.message ?? String(e))
                      );
                    }}
                  />
                </label>
                <div className="notifNote">
                  <span className="inlineBadge">Quit</span>
                  <span>Fully stops seamless background alerts.</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showQuietHours && cfg ? (
          <div
            className="qhOverlay settingsSubOverlay"
            onClick={() => {
              if (quietSaving) return;
              setShowQuietHours(false);
              setQuietErr(null);
            }}
          >
            <div
              className="qhModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Quiet hours"
            >
              <div className="settingsSubHeader">
                <button
                  type="button"
                  className="settingsBackBtn"
                  aria-label="Back to settings"
                  onClick={() => {
                    if (quietSaving) return;
                    setShowQuietHours(false);
                    setQuietErr(null);
                    setShowSettings(true);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Settings
                </button>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close quiet hours"
                  onClick={() => {
                    if (quietSaving) return;
                    setShowQuietHours(false);
                    setQuietErr(null);
                  }}
                >
                  <svg className="iconSvg close" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
                  </svg>
                </button>
              </div>
              <div className="settingsSubTitle">Quiet Hours</div>
              <div className="settingsSubHelp">
                Mute notifications during specific times. Monitoring continues.
              </div>

              {quietErr ? <div className="qhError">{quietErr}</div> : null}

              <div className="qhBody">
                {quietDraft.map((span, idx) => (
                  <div className="qhPeriod" key={idx}>
                    <div className="qhPeriodHeader">
                      <span className="qhPeriodLabel">
                        {quietDraft.length > 1 ? `Period ${idx + 1}` : "Mute from"}
                      </span>
                      {confirmRemoveQH === idx ? (
                        <span className="qhConfirmRemove">
                          <span className="qhConfirmText">Remove?</span>
                          <button
                            type="button"
                            className="qhConfirmYes"
                            onClick={() => {
                              setQuietDraft((d) => d.filter((_, i) => i !== idx));
                              setConfirmRemoveQH(null);
                            }}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            className="qhConfirmNo"
                            onClick={() => setConfirmRemoveQH(null)}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="qhRemoveIcon"
                          disabled={quietSaving}
                          aria-label="Remove period"
                          onClick={() => setConfirmRemoveQH(idx)}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M4.5 2H11.5M2 4H14M12.667 4L12.111 12.067C12.048 12.956 11.296 13.667 10.405 13.667H5.595C4.704 13.667 3.952 12.956 3.889 12.067L3.333 4M6.333 7.333V10.667M9.667 7.333V10.667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="qhInlineRow">
                      <div className="qhInlineTime">
                        <input
                          className="qhTimeCompact"
                          type="number"
                          min={1}
                          max={12}
                          placeholder="10"
                          value={span.start.hh}
                          aria-label={`quiet-${idx}-start-hour`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], start: { ...next[idx].start, hh: v } };
                              return next;
                            });
                          }}
                        />
                        <span className="qhTimeSep">:</span>
                        <input
                          className="qhTimeCompact"
                          type="number"
                          min={0}
                          max={59}
                          placeholder="00"
                          value={span.start.mm}
                          aria-label={`quiet-${idx}-start-minute`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], start: { ...next[idx].start, mm: v } };
                              return next;
                            });
                          }}
                        />
                        <select
                          className="qhAmPmCompact"
                          value={span.start.ampm}
                          aria-label={`quiet-${idx}-start-ampm`}
                          onChange={(e) => {
                            const v = e.target.value as AmPm;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], start: { ...next[idx].start, ampm: v } };
                              return next;
                            });
                          }}
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                      <span className="qhArrow">→</span>
                      <div className="qhInlineTime">
                        <input
                          className="qhTimeCompact"
                          type="number"
                          min={1}
                          max={12}
                          placeholder="7"
                          value={span.end.hh}
                          aria-label={`quiet-${idx}-end-hour`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], end: { ...next[idx].end, hh: v } };
                              return next;
                            });
                          }}
                        />
                        <span className="qhTimeSep">:</span>
                        <input
                          className="qhTimeCompact"
                          type="number"
                          min={0}
                          max={59}
                          placeholder="00"
                          value={span.end.mm}
                          aria-label={`quiet-${idx}-end-minute`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], end: { ...next[idx].end, mm: v } };
                              return next;
                            });
                          }}
                        />
                        <select
                          className="qhAmPmCompact"
                          value={span.end.ampm}
                          aria-label={`quiet-${idx}-end-ampm`}
                          onChange={(e) => {
                            const v = e.target.value as AmPm;
                            setQuietDraft((d) => {
                              const next = d.slice();
                              next[idx] = { ...next[idx], end: { ...next[idx].end, ampm: v } };
                              return next;
                            });
                          }}
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="qhFooter">
                  {quietDraft.length < MAX_QUIET_SPANS ? (
                    <button
                      type="button"
                      className="qhAddPeriod"
                      disabled={quietSaving}
                      onClick={() => {
                        setQuietDraft((d) => [...d, defaultQuietSpan()]);
                      }}
                    >
                      + Add quiet period
                    </button>
                  ) : <div />}

                  <div className="qhFooterRight">
                    <button
                      type="button"
                      className="modalBtn"
                      disabled={quietSaving}
                      onClick={() => {
                        if (quietSaving) return;
                        setShowQuietHours(false);
                        setQuietErr(null);
                      }}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      disabled={quietSaving || quietSaved}
                      className={`qhSave${quietSaved ? " saved" : ""}`}
                      onClick={async () => {
                        if (!cfg) return;
                        const v = validateQuietDraft(quietDraft);
                        if (!v.ok) {
                          setQuietErr(v.error || "Invalid quiet hours.");
                          return;
                        }
                        setQuietSaving(true);
                        setQuietErr(null);
                        try {
                          const next = structuredClone(cfg);
                          next.quietHours = v.ranges;
                          const saved = await putConfig(
                            stripLegacyForsenConfig(next)
                          );
                          applyConfig(saved);
                          setQuietSaving(false);
                          setQuietSaved(true);
                          window.setTimeout(() => {
                            setShowQuietHours(false);
                            setQuietSaved(false);
                          }, 900);
                        } catch (e: any) {
                          setQuietErr(e?.message ?? String(e));
                          setQuietSaving(false);
                        }
                      }}
                    >
                      {quietSaved ? (
                        <>
                          <svg
                            className="savedCheck"
                            viewBox="0 0 14 14"
                            aria-hidden="true"
                          >
                            <path
                              d="M2.5 7.5L5.5 10.5L11.5 4"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                            />
                          </svg>
                          Saved
                        </>
                      ) : quietSaving ? (
                        "Saving…"
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showAddStreamer ? (
          <div
            className="qhOverlay"
            onClick={() => {
              setShowAddStreamer(false);
              setAddStreamerErr(null);
            }}
          >
            <div
              className="qhModal qhModal--xs"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Add streamer"
            >
              <div className="qhHeader">
                <div>
                  <div className="qhTitle">Add Streamer</div>
                  <div className="qhHelp">
                    Enter a{" "}
                    <a
                      className="installGuideInlineLink"
                      href="https://paceman.gg/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Paceman
                    </a>{" "}
                    player name (not always their Twitch handle).
                  </div>
                </div>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close add streamer"
                  onClick={() => {
                    setShowAddStreamer(false);
                    setAddStreamerErr(null);
                  }}
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>

              {addStreamerErr ? (
                <div className="qhError">{addStreamerErr}</div>
              ) : null}

              <div className="promptBody">
                <input
                  className="promptInput"
                  value={addStreamerName}
                  onChange={(e) => setAddStreamerName(e.target.value)}
                  placeholder="e.g. xQc"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void submitAddStreamer();
                  }}
                />
              </div>

              <div className="promptActions">
                <button
                  type="button"
                  className="modalBtn"
                  onClick={() => {
                    setShowAddStreamer(false);
                    setAddStreamerErr(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="qhSave"
                  onClick={() => void submitAddStreamer()}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pendingRemove ? (
          <div
            className="qhOverlay"
            onClick={() => setPendingRemove(null)}
          >
            <div
              className="qhModal qhModal--sm"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Remove streamer"
            >
              <div className="qhHeader">
                <div>
                  <div className="qhTitle">Remove streamer?</div>
                  <div className="qhHelp">
                    This will remove <strong>{pendingRemove}</strong> from your
                    dashboard (and delete their saved thresholds on this browser).
                  </div>
                </div>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close remove streamer"
                  onClick={() => setPendingRemove(null)}
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>

              <div className="promptActions">
                <button
                  type="button"
                  className="modalBtn"
                  onClick={() => setPendingRemove(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="modalBtn modalBtn--danger modalBtn--solid"
                  onClick={() => {
                    const name = pendingRemove;
                    setPendingRemove(null);
                    if (name) void confirmRemoveStreamer(name);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showCopyFallback ? (
          <div className="qhOverlay" onClick={() => setShowCopyFallback(false)}>
            <div
              className="qhModal qhModal--sm"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={copyFallbackTitle}
            >
              <div className="qhHeader">
                <div>
                  <div className="qhTitle">{copyFallbackTitle}</div>
                  <div className="qhHelp">
                    Your browser blocked clipboard access. Copy the command below.
                  </div>
                </div>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close copy command"
                  onClick={() => setShowCopyFallback(false)}
                >
                  <svg
                    className="iconSvg close"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
                    />
                  </svg>
                </button>
              </div>

              <div className="installCommand" style={{ marginTop: 12 }}>
                {copyFallbackCommand}
              </div>

              <div className="promptActions">
                <button
                  type="button"
                  className="modalBtn"
                  onClick={() => setShowCopyFallback(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
