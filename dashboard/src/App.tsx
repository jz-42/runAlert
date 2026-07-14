import "./App.css";

import React, { useEffect, useRef, useState } from "react";
import {
  createPairingLink,
  exchangePairingCode,
  getConfig,
  getPacemanMilestones,
  getProfiles,
  getStatuses,
  getTwitchStatuses,
  getReleaseManifest,
  isDesktopApp,
  putConfigRaw,
  subscribeConfigChanges,
} from "./api";
import { trackEvent } from "./analytics";
import { CANONICAL_MILESTONES, milestoneLabel } from "./config";
import { useConfigSurface } from "./persistence/useConfigSurface";
import dashboardPackage from "../package.json";

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

type ReleaseManifest = {
  version: string;
  mac?: {
    available?: boolean;
    dmgUrl?: string | null;
    zipUrl?: string | null;
    universal?: boolean;
  };
  windows?: {
    available?: boolean;
    storeUrl?: string | null;
  };
};

type PairingLink = {
  deepLink: string;
  code: string;
  expiresAt: string;
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

const APP_VERSION = dashboardPackage.version;
const APP_CHANNEL = "Stable";
const MAX_STREAMERS = 15;
const MAX_QUIET_SPANS = 3;
const BROWSER_ALERTS_LEGACY_KEY = "runalert-browser-alerts";
const BROWSER_ALERTS_DEDUPE_KEY = "runalert-browser-alerts-dedupe";
const ONBOARDING_DISMISSED_KEY = "runalert-onboarding-dismissed";
const APP_FIRST_OPENED_KEY = "runalert-app-first-opened";
const DESKTOP_BG_RUNNING_KEY = "runalert-desktop-background-running";
const GITHUB_REPO_URL = "https://github.com/jz-42/runAlert";
const GITHUB_RELEASE_URL = `${GITHUB_REPO_URL}/releases/tag/v${APP_VERSION}`;

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
            runAlert-{APP_VERSION}-universal.dmg
          </span>
          ).
        </>
      ),
      details: [
        "The download comes from runalert.app and the public GitHub release for jz-42/runAlert.",
        "The release is signed with an Apple Developer ID and notarized by Apple.",
        "No account required.",
      ],
      note: (
        <>
          <span className="installGuideNoteLabel">Verify your download:</span>{" "}
          You can review the{" "}
          <a
            className="installGuideInlineLink"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            public source code
          </a>{" "}
          and verify the{" "}
          <a
            className="installGuideInlineLink installGuideInlineLink--checksum"
            href={GITHUB_RELEASE_URL}
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
      title: "Open runAlert",
      body:
        "Open runAlert from Applications, then allow notifications when macOS asks.",
      details: [
        "runAlert keeps monitoring in the menu bar after you close its window.",
        "If macOS blocks the signed app, confirm you downloaded it from runalert.app and report the release instead of bypassing the warning.",
      ],
      imageSrc: "/install-guide/step-5-notification-settings.png",
      imageAlt: "macOS notification settings for runAlert",
    },
  ],
  windows: [
    {
      eyebrow: "Step 1",
      title: "Get runAlert from Microsoft Store",
      body: "Open the certified Store listing and select Install.",
    },
    {
      eyebrow: "Step 2",
      title: "Open runAlert",
      body: "Launch runAlert from Start after the Store finishes installing it.",
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
  const platform = desktopApp
    ? (window as any).runAlertDesktop?.platform === "win32"
      ? "windows"
      : "mac"
    : "web";
  const [showSettings, setShowSettings] = useState(false);
  const [showQuietHours, setShowQuietHours] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [showAddStreamer, setShowAddStreamer] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showInstallDetails, setShowInstallDetails] = useState(false);
  const [installGuidePlatform, setInstallGuidePlatform] =
    useState<InstallGuidePlatform>("mac");
  const [installGuideStep, setInstallGuideStep] = useState(0);
  const [addStreamerName, setAddStreamerName] = useState("");
  const [addStreamerErr, setAddStreamerErr] = useState<string | null>(null);
  const [addStreamerBusy, setAddStreamerBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [releaseManifest, setReleaseManifest] =
    useState<ReleaseManifest | null>(null);
  const [pairingLink, setPairingLink] = useState<PairingLink | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingStatus, setPairingStatus] = useState<
    "idle" | "working" | "paired" | "error"
  >("idle");
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<Record<string, MilestoneCfg>>({});
  const draftRef = useRef(draft);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  });
  const [browserAlertsErr, setBrowserAlertsErr] = useState<string | null>(null);
  const browserMigrationDoneRef = useRef(false);
  const [allToggleOn, setAllToggleOn] = useState(true);
  const [allToggleOwner, setAllToggleOwner] = useState<string | null>(null);

  const configSurface = useConfigSurface<Config | null>({
    initialValue: null,
    offlineStorageKey: "runalert-pending-config-v1",
    save: async (next) => {
      if (!next) return next;
      const sanitized = stripLegacyForsenConfig(next);
      const saved = await putConfigRaw(sanitized);
      if (
        saved &&
        typeof saved === "object" &&
        "streamers" in (saved as Record<string, unknown>)
      ) {
        return stripLegacyForsenConfig(saved as Config);
      }
      return sanitized;
    },
  });
  const cfg = configSurface.value;
  const [err, setErr] = useState<string | null>(null);
  const [quietDraft, setQuietDraft] = useState<QuietSpanDraft[]>([]);
  const quietDraftRef = useRef(quietDraft);
  const [quietErr, setQuietErr] = useState<string | null>(null);
  const [confirmRemoveQH, setConfirmRemoveQH] = useState<number | null>(null);
  const [milestoneErr, setMilestoneErr] = useState<string | null>(null);
  const [milestoneSaved, setMilestoneSaved] = useState(false);
  const [quietSaved, setQuietSaved] = useState(false);
  const milestoneSavedTimerRef = useRef<number | null>(null);
  const quietSavedTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    if (!cfg) return;
    return subscribeConfigChanges(async () => {
      if (configSurface.dirty) return;
      try {
        const next = await getConfig();
        configSurface.hydrateConfirmed(stripLegacyForsenConfig(next));
      } catch {
        // The regular offline state remains the single user-facing sync signal.
      }
    });
  }, [Boolean(cfg), configSurface.dirty]);

  useEffect(() => {
    if (!cfg || desktopApp) return;
    let cancelled = false;
    void getReleaseManifest()
      .then((manifest) => {
        if (!cancelled) setReleaseManifest(manifest as ReleaseManifest);
      })
      .catch(() => {
        if (!cancelled) setReleaseManifest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [Boolean(cfg), desktopApp]);

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

  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const suppressOpenRef = useRef(false);
  const addStreamerSubmissionRef = useRef(0);
  const browserAlertDedupeRef = useRef<
    Record<string, { runId: number | null; milestones: Record<string, boolean> }>
  >({});

  const macAppDownloadUrl = releaseManifest?.mac?.available
    ? releaseManifest.mac.dmgUrl || null
    : null;
  const macAppZipUrl = releaseManifest?.mac?.available
    ? releaseManifest.mac.zipUrl || null
    : null;
  const windowsStoreUrl = releaseManifest?.windows?.available
    ? releaseManifest.windows.storeUrl || null
    : null;
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
  const quietSaving = false;

  function applyConfig(next: Config) {
    configSurface.hydrateConfirmed(stripLegacyForsenConfig(next));
  }

  function updateConfig(
    updater: (current: Config) => Config,
    options: {
      save: "immediate" | "debounced";
      debounceMs?: number;
      onError?: (message: string) => void;
      onSuccess?: () => void;
    } = { save: "immediate" }
  ) {
    if (!configSurface.value) return;
    configSurface.applyOptimisticChange((current) => {
      if (!current) return current;
      return stripLegacyForsenConfig(updater(structuredClone(current)));
    });

    if (options.save === "debounced") {
      configSurface.scheduleDebouncedSave(options.debounceMs ?? 700);
      return;
    }

    void configSurface
      .flushNow()
      .then(() => options.onSuccess?.())
      .catch((e: any) => options.onError?.(e?.message ?? String(e)));
  }

  async function flushConfigNow(onError?: (message: string) => void) {
    try {
      await configSurface.flushNow();
      return true;
    } catch (e: any) {
      onError?.(e?.message ?? String(e));
      return false;
    }
  }

  async function generatePairingLink() {
    setPairingStatus("working");
    setPairingError(null);
    try {
      const link = await createPairingLink("Desktop app");
      setPairingLink(link as PairingLink);
      setPairingStatus("idle");
    } catch (error: any) {
      setPairingStatus("error");
      setPairingError(error?.message || "Could not create a pairing link.");
    }
  }

  async function pairDesktopManually() {
    const normalized = pairingCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(normalized)) {
      setPairingError("Enter the eight-character pairing code from runalert.app.");
      return;
    }
    setPairingStatus("working");
    setPairingError(null);
    try {
      const result = await exchangePairingCode(normalized, "Desktop app");
      const imported = result?.envelope?.config;
      if (imported) configSurface.hydrateConfirmed(stripLegacyForsenConfig(imported));
      setPairingStatus("paired");
    } catch (error: any) {
      setPairingStatus("error");
      setPairingError(error?.message || "The pairing code is invalid or expired.");
    }
  }

  function exportConfigBackup() {
    if (!cfg) return;
    const blob = new Blob(
      [
        `${JSON.stringify(
          { schemaVersion: 1, exportedAt: new Date().toISOString(), config: cfg },
          null,
          2
        )}\n`,
      ],
      { type: "application/json" }
    );
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "runalert-config-v1.json";
    anchor.click();
    URL.revokeObjectURL(href);
    void trackEvent("config_exported", { surface: "settings" });
  }

  async function importConfigBackup(file: File) {
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text());
      const imported = (parsed?.config || parsed) as Config;
      if (
        !imported ||
        !Array.isArray(imported.streamers) ||
        imported.streamers.length > MAX_STREAMERS ||
        !Array.isArray(imported.quietHours) ||
        !imported.defaultMilestones ||
        !CANONICAL_MILESTONES.every(
          (milestone) => imported.defaultMilestones?.[milestone]
        ) ||
        !imported.profiles ||
        typeof imported.profiles !== "object"
      ) {
        throw new Error("This is not a valid runAlert v1 config backup.");
      }
      updateConfig(() => stripLegacyForsenConfig(imported), {
        save: "immediate",
        onError: (message) => setImportError(message),
        onSuccess: () => setImportError(null),
      });
      void trackEvent("config_imported", { surface: "settings" });
    } catch (error: any) {
      setImportError(error?.message || "Could not read this config backup.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function updateMilestoneDraft(
    streamerName: string,
    nextDraft: Record<string, MilestoneCfg>,
    options: {
      save: "immediate" | "debounced";
      debounceMs?: number;
      onError?: (message: string) => void;
      onSuccess?: () => void;
    }
  ) {
    setDraft(nextDraft);
    setMilestoneErr(null);
    updateConfig(
      (nextCfg) => {
        nextCfg.profiles = nextCfg.profiles || {};
        nextCfg.profiles[streamerName] = {
          ...(nextCfg.profiles[streamerName] || {}),
          ...nextDraft,
        };
        return nextCfg;
      },
      options
    );
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

  async function enableBrowserAlerts() {
    setBrowserAlertsErr(null);
    if (browserPermission === "unsupported") {
      setBrowserAlertsErr("Browser notifications are not supported here.");
      if (!notificationsEnabled) toggleNotificationsEnabled(true);
      return;
    }
    if (browserPermission === "denied") {
      setBrowserAlertsErr(
        "Notifications are blocked in this browser. Enable them in browser settings."
      );
      if (!notificationsEnabled) toggleNotificationsEnabled(true);
      return;
    }
    if (browserPermission === "default") {
      const perm = await Notification.requestPermission();
      setBrowserPermission(perm);
      if (perm !== "granted") {
        setBrowserAlertsErr("Notification permission was denied.");
        if (!notificationsEnabled) toggleNotificationsEnabled(true);
        return;
      }
    }
    if (!notificationsEnabled) toggleNotificationsEnabled(true);
    void trackEvent("browser_alerts_enabled", { enabled: true });
  }

  function disableBrowserAlerts() {
    setBrowserAlertsErr(null);
    if (notificationsEnabled) toggleNotificationsEnabled(false);
    void trackEvent("browser_alerts_enabled", { enabled: false });
  }

  function updateNotificationPrefs({
    enabled = notificationsEnabled,
    sound = notificationSoundEnabled,
  }: {
    enabled?: boolean;
    sound?: boolean;
  }) {
    setErr(null);
    updateConfig(
      (updated) => {
        updated.notifications = {
          ...(updated.notifications || {}),
          enabled,
          sound,
        };
        return updated;
      },
      {
        save: "immediate",
        onError: (message) => setErr(message),
      }
    );
  }

  function toggleNotificationsEnabled(next: boolean) {
    updateNotificationPrefs(
      next ? { enabled: true } : { enabled: false, sound: false }
    );
  }

  function toggleNotificationSound(next: boolean) {
    updateNotificationPrefs({ sound: next });
  }

  function updateBackgroundMonitoring(next: boolean) {
    setErr(null);
    updateConfig(
      (updated) => {
        updated.agent = {
          ...(updated.agent || {}),
          autoUpdate: updated.agent?.autoUpdate ?? agentAutoUpdateEnabled,
          backgroundMonitoring: next,
        };
        return updated;
      },
      {
        save: "immediate",
        onError: (message) => setErr(message),
      }
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
    if (!cfg) return;
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

  function queueQuietHoursDraft(
    nextDraft: QuietSpanDraft[],
    save: "immediate" | "debounced"
  ) {
    setQuietDraft(nextDraft);
    const validation = validateQuietDraft(nextDraft);
    if (!validation.ok) {
      configSurface.cancelDebounce();
      setQuietErr(validation.error || "Invalid quiet hours.");
      return;
    }

    setQuietErr(null);
    updateConfig(
      (nextCfg) => {
        nextCfg.quietHours = validation.ranges;
        return nextCfg;
      },
      {
        save,
        debounceMs: 700,
        onError: (message) => {
          setQuietErr(message);
        },
      }
    );
  }

  function openAddStreamerPrompt() {
    if (cfg && (cfg.streamers ?? []).length >= MAX_STREAMERS) {
      setErr(
        `Max streamers reached (${MAX_STREAMERS}). Remove one to add more.`
      );
      return;
    }
    addStreamerSubmissionRef.current += 1;
    setAddStreamerBusy(false);
    setAddStreamerErr(null);
    setAddStreamerName("");
    setShowAddStreamer(true);
  }

  function closeAddStreamerPrompt() {
    addStreamerSubmissionRef.current += 1;
    setAddStreamerBusy(false);
    setShowAddStreamer(false);
    setAddStreamerErr(null);
  }

  async function submitAddStreamer() {
    if (addStreamerBusy) return;
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

    // Verify the name exists on Paceman before saving, so a typo doesn't
    // leave a permanently silent tile. runId === null is the server's
    // explicit "no runs found"; an unexpected shape fails open.
    const submissionId = addStreamerSubmissionRef.current + 1;
    addStreamerSubmissionRef.current = submissionId;
    setAddStreamerBusy(true);
    try {
      const check = await getPacemanMilestones(name);
      if (addStreamerSubmissionRef.current !== submissionId) return;
      if (check?.runId === null) {
        setAddStreamerErr(
          `"${name}" wasn't found on Paceman. It's their Paceman player name, which isn't always their Twitch handle.`
        );
        return;
      }
    } catch {
      if (addStreamerSubmissionRef.current !== submissionId) return;
      setAddStreamerErr(
        "Couldn't reach Paceman to verify the name. Try again in a moment."
      );
      return;
    } finally {
      if (addStreamerSubmissionRef.current === submissionId) {
        setAddStreamerBusy(false);
      }
    }

    if (addStreamerSubmissionRef.current !== submissionId) return;

    setErr(null);

    // Close modal immediately for a snappy feel
    closeAddStreamerPrompt();

    updateConfig(
      (optimistic) => {
        optimistic.streamers = [...(optimistic.streamers ?? []), name];
        return optimistic;
      },
      {
        save: "immediate",
        onError: (message) => setErr(message),
        onSuccess: () => {
          void trackEvent("streamer_added", { streamer: name });
        },
      }
    );
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

    setErr(null);

    // Close the panel if this streamer was selected
    if (selected === name) {
      setSelected(null);
    }

    updateConfig(
      (optimistic) => {
        optimistic.streamers = (optimistic.streamers ?? []).filter(
          (s) => s !== name
        );
        if (optimistic.profiles?.[name]) {
          delete optimistic.profiles[name];
        }
        return optimistic;
      },
      {
        save: "immediate",
        onError: (message) => setErr(message),
        onSuccess: () => {
          void trackEvent("streamer_removed", { streamer: name });
        },
      }
    );
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

  // Escape closes the topmost open surface, mirroring click-outside.
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (pendingRemove) {
        setPendingRemove(null);
      } else if (showAddStreamer) {
        closeAddStreamerPrompt();
      } else if (showQuietHours) {
        if (quietSaving) return;
        setShowQuietHours(false);
        setQuietErr(null);
      } else if (showNotifications) {
        setShowNotifications(false);
      } else if (showAgentSettings) {
        setShowAgentSettings(false);
      } else if (showSyncSettings) {
        setShowSyncSettings(false);
      } else if (showInstallDetails) {
        setShowInstallDetails(false);
      } else if (showOnboarding) {
        dismissOnboarding();
      } else if (showSettings) {
        setShowSettings(false);
      } else if (selected) {
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  });

  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "denied"
    ) {
      setBrowserAlertsErr(
        "Notifications are blocked in this browser. Enable them in browser settings."
      );
    }
    loadBrowserAlertDedupe();
  }, []);

  // One-time migration from the old browser-alerts localStorage key into cfg.notifications.enabled.
  // Runs once cfg is loaded so we don't overwrite an explicit server-side preference with stale local state.
  useEffect(() => {
    if (!cfg || browserMigrationDoneRef.current) return;
    let legacy: string | null = null;
    try {
      legacy = window.localStorage.getItem(BROWSER_ALERTS_LEGACY_KEY);
    } catch {
      // ignore storage failures
    }
    if (legacy === "false" && cfg.notifications?.enabled !== false) {
      toggleNotificationsEnabled(false);
    }
    try {
      window.localStorage.removeItem(BROWSER_ALERTS_LEGACY_KEY);
    } catch {
      // ignore storage failures
    }
    browserMigrationDoneRef.current = true;
  }, [cfg]);

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

  useEffect(() => {
    if (!selected) return;
    setDraft(getMilestonesForStreamer(selected));
  }, [selected, cfg]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    quietDraftRef.current = quietDraft;
  }, [quietDraft]);

  useEffect(() => {
    return () => {
      if (milestoneSavedTimerRef.current) {
        window.clearTimeout(milestoneSavedTimerRef.current);
      }
      if (quietSavedTimerRef.current) {
        window.clearTimeout(quietSavedTimerRef.current);
      }
    };
  }, []);

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
    updateConfig(
      (updated) => {
        updated.streamers = next;
        return updated;
      },
      {
        save: "immediate",
        onError: (message) => setErr(message),
      }
    );
  };

  const quietHoursSummary = formatQuietHoursSummary(cfg?.quietHours);
  const desktopNotificationsSummary = notificationsEnabled ? "On" : "Off";
  const browserAlertsActive =
    notificationsEnabled && browserPermission === "granted";
  const browserAlertsSummary = browserAlertsActive ? "On" : "Off";
  const backgroundSummary = backgroundMonitoringEnabled ? "On" : "Off";
  const installGuide = INSTALL_GUIDES[installGuidePlatform];
  const activeInstallStep = installGuide[installGuideStep] ?? installGuide[0];
  const guidePrimaryUrl =
    installGuidePlatform === "mac" ? macAppDownloadUrl : windowsStoreUrl;
  const guidePrimaryLabel =
    installGuidePlatform === "mac" ? "Download universal DMG" : "Open Microsoft Store";

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

  // Past this, "Last update • Nd ago" reads like a bug — show a calmer
  // "No recent runs" instead.
  const STALE_RUN_SEC = 7 * 24 * 60 * 60;

  function subtitleFor(name: string): string | null {
    const s = statusByName[name];
    const badge = getBadgeData(name);
    if (!s) return null;
    if (badge) return badgeTitleFor(name);

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof s.lastUpdatedSec === "number") {
      const agoSec = Math.max(0, nowSec - s.lastUpdatedSec);
      if (agoSec >= STALE_RUN_SEC) return "No recent runs";
      const ago = formatAgo(agoSec);
      return ago ? `Last update • ${ago}` : null;
    }
    return null;
  }

  return (
    <div className={`page platform-${platform}`} data-platform={platform}>
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
                      title="Stable runAlert v1 release"
                    >
                      {APP_CHANNEL}
                    </a>
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
                            browserAlertsActive
                              ? disableBrowserAlerts()
                              : enableBrowserAlerts()
                          }
                          aria-label={
                            browserAlertsActive
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
                              browserAlertsActive ? "on" : "off"
                            }`}
                            aria-label={
                              browserAlertsActive
                                ? "Disable browser alerts"
                                : "Enable browser alerts"
                            }
                            onClick={() =>
                              browserAlertsActive
                                ? disableBrowserAlerts()
                                : enableBrowserAlerts()
                            }
                          >
                            {browserAlertsActive ? (
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
        {configSurface.saveState === "offline" ? (
          <div className="syncNotice" role="status">
            <span>Offline — changes are saved on this device and will retry automatically.</span>
            <button type="button" onClick={() => void configSurface.retrySave().catch(() => {})}>
              Retry now
            </button>
          </div>
        ) : null}
        {configSurface.saveState === "conflict" ? (
          <div className="syncNotice syncNotice--conflict" role="alert">
            <span>These settings changed on another device. Choose which version to keep.</span>
            <button type="button" onClick={configSurface.resolveConflictWithServer}>
              Use synced version
            </button>
            <button
              type="button"
              onClick={() => void configSurface.resolveConflictKeepLocal().catch(() => {})}
            >
              Keep this device
            </button>
          </div>
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
                    if (!selected) return;
                    const nextEnabled = e.target.checked;
                    setAllToggleOn(nextEnabled);
                    const streamerName = selected;
                    const nextDraft = { ...draftRef.current };
                    for (const key of Object.keys(nextDraft)) {
                      nextDraft[key] = {
                        ...nextDraft[key],
                        enabled: nextEnabled,
                      };
                    }
                    updateMilestoneDraft(streamerName, nextDraft, {
                      save: "immediate",
                      onError: (message) => setMilestoneErr(message),
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
                            if (!selected) return;
                            const streamerName = selected;
                            const raw = e.target.value;
                            const currentDraft = draftRef.current;
                            const cur = currentDraft[milestone]?.thresholdSec;
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

                            const nextDraft = {
                              ...currentDraft,
                              [milestone]: {
                                ...currentDraft[milestone],
                                thresholdSec: nextSec,
                              },
                            };
                            updateMilestoneDraft(streamerName, nextDraft, {
                              save: "debounced",
                              debounceMs: 700,
                            });
                          }}
                          onBlur={() => {
                            void flushConfigNow((message) => setMilestoneErr(message));
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            void flushConfigNow((message) => setMilestoneErr(message));
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
                            if (!selected) return;
                            const streamerName = selected;
                            const raw = e.target.value;
                            const currentDraft = draftRef.current;
                            const cur = currentDraft[milestone]?.thresholdSec;
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

                            const nextDraft = {
                              ...currentDraft,
                              [milestone]: {
                                ...currentDraft[milestone],
                                thresholdSec: nextSec,
                              },
                            };
                            updateMilestoneDraft(streamerName, nextDraft, {
                              save: "debounced",
                              debounceMs: 700,
                            });
                          }}
                          onBlur={() => {
                            void flushConfigNow((message) => setMilestoneErr(message));
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            void flushConfigNow((message) => setMilestoneErr(message));
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
                            if (!selected) return;
                            const streamerName = selected;
                            const on = e.target.checked;
                            const currentDraft = draftRef.current;
                            const nextDraft = {
                              ...currentDraft,
                              [milestone]: {
                                ...currentDraft[milestone],
                                enabled: on,
                              },
                            };
                            updateMilestoneDraft(streamerName, nextDraft, {
                              save: "immediate",
                              onError: (message) => setMilestoneErr(message),
                            });
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            {milestoneErr ? <div className="configError">{milestoneErr}</div> : null}

            <div className="milestonePanelFooter">
              <button
                onClick={() => {
                  setSelected(null);
                }}
                className="modalBtn"
              >
                Close
              </button>

              <button
                disabled={!cfg || !selected || milestoneSaved}
                onClick={async () => {
                  const ok = await flushConfigNow((message) =>
                    setMilestoneErr(message)
                  );
                  if (!ok) return;
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
                aria-label={`Edit alerts for ${name}`}
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
                className={`milestoneSubtitle milestoneLink${
                  subtitleFor(name) === "No recent runs"
                    ? " milestoneSubtitle--stale"
                    : ""
                }`}
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
            <button
              className="avatarBtn add"
              aria-label="Add streamer"
              onClick={openAddStreamerPrompt}
            >
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
                {releaseManifest?.version
                  ? `v${releaseManifest.version} · signed apps for background alerts.`
                  : "Signed apps for background alerts."}
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
                {macAppDownloadUrl ? "Download Mac" : "Mac app coming soon"}
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
                {windowsStoreUrl ? "Get from Microsoft Store" : "Windows app coming soon"}
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
                        {guidePrimaryUrl ? <a
                          className="installButton installButton--primary"
                          href={guidePrimaryUrl}
                          target={installGuidePlatform === "windows" ? "_blank" : undefined}
                          rel={installGuidePlatform === "windows" ? "noreferrer" : undefined}
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
                        </a> : (
                          <button className="installButton" type="button" disabled>
                            Not available yet
                          </button>
                        )}
                        {installGuidePlatform === "mac" && macAppZipUrl ? (
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
                          href={GITHUB_RELEASE_URL}
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
                {desktopApp ? (
                  <button
                    className="settingsMenuBtn"
                    onClick={() => {
                      setShowSettings(false);
                      setShowAgentSettings(true);
                    }}
                  >
                    Background Monitoring
                  </button>
                ) : null}
                <button
                  className="settingsMenuBtn"
                  onClick={() => {
                    setShowSettings(false);
                    setShowSyncSettings(true);
                    setPairingError(null);
                  }}
                >
                  Sync &amp; Backup
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showSyncSettings ? (
          <div
            className="qhOverlay settingsSubOverlay"
            onClick={() => setShowSyncSettings(false)}
          >
            <div
              className="qhModal qhModal--sm"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-label="Sync and backup"
            >
              <div className="settingsSubHeader">
                <button
                  type="button"
                  className="settingsBackBtn"
                  onClick={() => {
                    setShowSyncSettings(false);
                    setShowSettings(true);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Settings
                </button>
                <button
                  type="button"
                  className="iconBtn iconBtn--close"
                  aria-label="Close sync and backup"
                  onClick={() => setShowSyncSettings(false)}
                >
                  <svg className="iconSvg close" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
                  </svg>
                </button>
              </div>
              <div className="settingsSubTitle">Sync &amp; Backup</div>
              <div className="settingsSubHelp">
                Your anonymous settings sync across paired devices. No account or email required.
              </div>

              <section className="syncSection" aria-labelledby="pair-device-title">
                <h3 id="pair-device-title">
                  {desktopApp ? "Pair this desktop" : "Pair a desktop app"}
                </h3>
                {desktopApp ? (
                  <>
                    <p>On runalert.app, create a pairing link and open it on this computer.</p>
                    {pairingStatus === "paired" ? (
                      <div className="syncSuccess" role="status">Paired. Your synced settings are ready.</div>
                    ) : null}
                    <details className="syncTroubleshooting">
                      <summary>Pair with a manual code</summary>
                      <label className="syncCodeLabel" htmlFor="pairing-code">Pairing code</label>
                      <div className="syncCodeRow">
                        <input
                          id="pairing-code"
                          value={pairingCode}
                          inputMode="text"
                          autoCapitalize="characters"
                          autoComplete="off"
                          placeholder="ABCD-EFGH"
                          onChange={(event) => setPairingCode(event.target.value)}
                        />
                        <button
                          type="button"
                          className="installButton installButton--primary"
                          disabled={pairingStatus === "working"}
                          onClick={() => void pairDesktopManually()}
                        >
                          {pairingStatus === "working" ? "Pairing…" : "Pair"}
                        </button>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <p>Create a one-time link that expires in ten minutes.</p>
                    {!pairingLink ? (
                      <button
                        type="button"
                        className="installButton installButton--primary"
                        disabled={pairingStatus === "working"}
                        onClick={() => void generatePairingLink()}
                      >
                        {pairingStatus === "working" ? "Creating…" : "Create pairing link"}
                      </button>
                    ) : (
                      <div className="pairingResult">
                        <a className="installButton installButton--primary" href={pairingLink.deepLink}>
                          Open runAlert and pair
                        </a>
                        <span>Expires {new Date(pairingLink.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                        <details className="syncTroubleshooting">
                          <summary>Desktop app did not open?</summary>
                          <p>Enter this one-time code in the desktop app:</p>
                          <code>{pairingLink.code}</code>
                        </details>
                      </div>
                    )}
                  </>
                )}
                {pairingError ? <div className="qhError" role="alert">{pairingError}</div> : null}
              </section>

              <section className="syncSection" aria-labelledby="backup-title">
                <h3 id="backup-title">Local recovery backup</h3>
                <p>Export a JSON copy or import one you saved earlier.</p>
                <div className="syncBackupActions">
                  <button type="button" className="installButton" onClick={exportConfigBackup}>
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="installButton"
                    onClick={() => importInputRef.current?.click()}
                  >
                    Import JSON
                  </button>
                  <input
                    ref={importInputRef}
                    className="visuallyHidden"
                    type="file"
                    accept="application/json,.json"
                    aria-label="Import runAlert config JSON"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importConfigBackup(file);
                    }}
                  />
                </div>
                {importError ? <div className="qhError" role="alert">{importError}</div> : null}
              </section>
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
                    onChange={(e) => {
                      if (desktopApp) {
                        toggleNotificationsEnabled(e.target.checked);
                      } else if (e.target.checked) {
                        void enableBrowserAlerts();
                      } else {
                        disableBrowserAlerts();
                      }
                    }}
                  />
                </label>
                {!desktopApp && browserAlertsErr ? (
                  <div className="notifNote alertsError">{browserAlertsErr}</div>
                ) : null}
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
                      setErr(null);
                      updateConfig(
                        (updated) => {
                          updated.agent = {
                            ...(updated.agent || {}),
                            autoUpdate: next,
                            backgroundMonitoring: backgroundMonitoringEnabled,
                          };
                          return updated;
                        },
                        {
                          save: "immediate",
                          onError: (message) => setErr(message),
                        }
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
                              const currentDraft = quietDraftRef.current;
                              queueQuietHoursDraft(
                                currentDraft.filter((_, i) => i !== idx),
                                "immediate"
                              );
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
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              start: { ...next[idx].start, hh: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
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
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              start: { ...next[idx].start, mm: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
                          }}
                        />
                        <select
                          className="qhAmPmCompact"
                          value={span.start.ampm}
                          aria-label={`quiet-${idx}-start-ampm`}
                          onChange={(e) => {
                            const v = e.target.value as AmPm;
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              start: { ...next[idx].start, ampm: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
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
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              end: { ...next[idx].end, hh: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
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
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              end: { ...next[idx].end, mm: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
                          }}
                        />
                        <select
                          className="qhAmPmCompact"
                          value={span.end.ampm}
                          aria-label={`quiet-${idx}-end-ampm`}
                          onChange={(e) => {
                            const v = e.target.value as AmPm;
                            const currentDraft = quietDraftRef.current;
                            const next = currentDraft.slice();
                            next[idx] = {
                              ...next[idx],
                              end: { ...next[idx].end, ampm: v },
                            };
                            queueQuietHoursDraft(next, "debounced");
                          }}
                          onBlur={() => {
                            const validation = validateQuietDraft(quietDraftRef.current);
                            if (validation.ok) {
                              void flushConfigNow((message) => {
                                setQuietErr(message);
                              });
                            }
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
                        const currentDraft = quietDraftRef.current;
                        queueQuietHoursDraft(
                          [...currentDraft, defaultQuietSpan()],
                          "immediate"
                        );
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
                        const v = validateQuietDraft(quietDraftRef.current);
                        if (!v.ok) {
                          setQuietErr(v.error || "Invalid quiet hours.");
                          return;
                        }
                        setQuietErr(null);
                        const ok = await flushConfigNow((message) => {
                          setQuietErr(message);
                        });
                        if (!ok) return;
                        if (quietSavedTimerRef.current) {
                          window.clearTimeout(quietSavedTimerRef.current);
                        }
                        setQuietSaved(true);
                        quietSavedTimerRef.current = window.setTimeout(() => {
                          setQuietSaved(false);
                          quietSavedTimerRef.current = null;
                        }, 1200);
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
            onClick={closeAddStreamerPrompt}
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
                  onClick={closeAddStreamerPrompt}
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
                  onClick={closeAddStreamerPrompt}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="qhSave"
                  disabled={addStreamerBusy}
                  onClick={() => void submitAddStreamer()}
                >
                  {addStreamerBusy ? "Checking…" : "Add"}
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
      </div>
    </div>
  );
}

export default App;
