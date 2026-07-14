// src/api/server.js (think this connects to frontend for milestone configuration)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { attachV1SyncApi } = require("../sync/v1_api");
const { createMemorySyncStore } = require("../sync/memory_sync_store");
const {
  createSupabaseSyncStoreFromEnv,
} = require("../sync/supabase_sync_store");
const {
  apiErrorHandler,
  createRateLimiter,
  createRequestLogger,
  securityHeaders,
} = require("./security");
function defaultIsAllowedOrigin(origin) {
  if (!origin) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function createApp({
  configPath = path.join(__dirname, "../../config.json"),
  releaseManifest = null,
  desktopNotifyBridge = false,
  enableLocalConfig,
  isAllowedOrigin = defaultIsAllowedOrigin,
  notifySend = require("../notify/router").send,
  paceman = require("../paceman/client"),
  syncStore,
  credentialPepper = process.env.RUNALERT_CREDENTIAL_PEPPER || "",
  now = () => new Date(),
  logger = process.env.NODE_ENV === "production" ? console : null,
  rateLimit = {},
  clientAddress,
} = {}) {
  const app = express();
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(createRequestLogger({ logger }));
  app.use(
    createRateLimiter({
      ...rateLimit,
      ...(clientAddress ? { clientAddress } : {}),
    })
  );
  app.use(express.json({ limit: "64kb", strict: true }));
  const MAX_NAMES = 15; // keep consistent with dashboard /config max streamers
  const localConfigEnabled = enableLocalConfig ?? desktopNotifyBridge;

  // Very small in-memory cache for endpoints that proxy paceman.gg.
  // This keeps the dashboard from hammering paceman when it polls.
  const memCache = new Map(); // key -> { exp: number, value: any }
  function cacheGet(key) {
    const hit = memCache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) {
      memCache.delete(key);
      return null;
    }
    return hit.value;
  }
  function cacheSet(key, value, ttlMs) {
    memCache.set(key, { exp: Date.now() + ttlMs, value });
  }

  const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || "";
  const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "";

  function normalizeTwitchHandle(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let handle = raw;
    handle = handle.replace(/^https?:\/\//i, "");
    handle = handle.replace(/^www\./i, "");
    if (handle.toLowerCase().startsWith("twitch.tv/")) {
      handle = handle.slice("twitch.tv/".length);
    }
    handle = handle.replace(/^@/, "");
    handle = handle.split(/[/?#]/)[0];
    return handle ? handle.trim() : null;
  }

  function parseNames(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return null;
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return null;
    if (names.length > MAX_NAMES) {
      return { error: `too many names (max ${MAX_NAMES})` };
    }
    return { names };
  }

  async function getTwitchAppToken() {
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return null;
    const cached = cacheGet("twitchAppToken");
    if (cached?.token && typeof cached?.exp === "number") {
      // refresh a minute early
      if (Date.now() < cached.exp - 60_000) return cached.token;
    }

    try {
      const tokenUrl =
        "https://id.twitch.tv/oauth2/token" +
        `?client_id=${encodeURIComponent(TWITCH_CLIENT_ID)}` +
        `&client_secret=${encodeURIComponent(TWITCH_CLIENT_SECRET)}` +
        "&grant_type=client_credentials";
      const resp = await fetch(tokenUrl, { method: "POST" });
      if (!resp.ok) return null;
      const data = await resp.json();
      const token = data?.access_token;
      const expiresIn = Number(data?.expires_in) || 3600;
      if (!token) return null;
      cacheSet(
        "twitchAppToken",
        {
          token,
          exp: Date.now() + expiresIn * 1000,
        },
        expiresIn * 1000
      );
      return token;
    } catch {
      return null;
    }
  }

  async function fetchTwitchAvatarUrl(handle) {
    const normalized = normalizeTwitchHandle(handle);
    if (!normalized) return null;

    // Prefer official Helix when credentials are present.
    try {
      const appToken = await getTwitchAppToken();
      if (TWITCH_CLIENT_ID && appToken) {
        const helixUrl = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(
          normalized
        )}`;
        const helixResp = await fetch(helixUrl, {
          headers: {
            "Client-ID": TWITCH_CLIENT_ID,
            Authorization: `Bearer ${appToken}`,
          },
        });
        if (helixResp.ok) {
          const data = await helixResp.json();
          const profileImage = Array.isArray(data?.data)
            ? data.data?.[0]?.profile_image_url
            : null;
          if (typeof profileImage === "string" && profileImage.trim()) {
            return profileImage.trim();
          }
        }
      }
    } catch {
      // Best-effort only.
    }

    // Fallback: decapi (no-auth). Returns the avatar URL as plain text.
    try {
      const url = `https://decapi.me/twitch/avatar/${encodeURIComponent(
        normalized
      )}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "runalert-avatar" },
      });
      if (!resp.ok) return null;
      const text = (await resp.text()).trim();
      if (/^https?:\/\//i.test(text)) return text;
    } catch {
      // Best-effort only.
    }

    return null;
  }

  async function fetchTwitchLive(handle) {
    const normalizedHandle = normalizeTwitchHandle(handle);
    if (!normalizedHandle) return null;
    const cacheKey = `twitchLive:${normalizedHandle.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (typeof cached === "boolean") return cached;

    try {
      const appToken = await getTwitchAppToken();
      if (TWITCH_CLIENT_ID && appToken) {
        const helixUrl = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(
          normalizedHandle
        )}`;
        const helixResp = await fetch(helixUrl, {
          headers: {
            "Client-ID": TWITCH_CLIENT_ID,
            Authorization: `Bearer ${appToken}`,
          },
        });
        if (helixResp.ok) {
          const data = await helixResp.json();
          const isLive = Array.isArray(data?.data) && data.data.length > 0;
          cacheSet(cacheKey, isLive, 60_000);
          return isLive;
        }
      }

      // Fallback: decapi (no-auth). Best-effort only.
      const url = `https://decapi.me/twitch/stream/${encodeURIComponent(
        normalizedHandle
      )}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "runalert-status" },
      });
      const text = await resp.text();
      if (resp.ok) {
        const normalized = text.trim().toLowerCase();
        const isOffline =
          normalized.includes("offline") ||
          normalized.includes("not live") ||
          normalized.includes("not online");
        const isLive = !isOffline && normalized.length > 0;
        cacheSet(cacheKey, isLive, 60_000);
        return isLive;
      }
    } catch {
      // Fall through to the public preview-image probe below.
    }

    try {
      const previewUrl = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(
        normalizedHandle.toLowerCase()
      )}-320x180.jpg`;
      const previewResp = await fetch(previewUrl, {
        headers: { "User-Agent": "runalert-status" },
        redirect: "manual",
      });
      const location = String(previewResp.headers?.get?.("location") || "").toLowerCase();
      if (
        previewResp.status >= 300 &&
        previewResp.status < 400 &&
        location.includes("/404_preview-")
      ) {
        cacheSet(cacheKey, false, 60_000);
        return false;
      }
      if (previewResp.ok) {
        cacheSet(cacheKey, true, 60_000);
        return true;
      }
    } catch {
      return null;
    }

    return null;
  }

  async function resolveStreamerProfile(name) {
    const key = `profileIdentity:${String(name || "").trim().toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    let runId = null;
    let twitch = null;
    let uuid = null;
    try {
      runId = await paceman.getRecentRunId(name, 1);
      if (runId) {
        const world = await paceman.getWorld(runId);
        twitch = normalizeTwitchHandle(world?.data?.twitch);
        uuid =
          typeof world?.data?.uuid === "string" && world.data.uuid.trim()
            ? world.data.uuid.trim()
            : null;
      }
    } catch {
      runId = null;
      twitch = null;
      uuid = null;
    }

    const value = { runId, twitch, uuid };
    // Cache hard: profile identity does not need rapid refresh.
    cacheSet(key, value, 6 * 60 * 60 * 1000);
    return value;
  }

  // Allow local dev frontends (Vite often bumps ports if 5173 is taken).
  // Keep this restricted to localhost / 127.0.0.1 for safety.
  app.use(
    cors({
      origin(origin, cb) {
        return cb(null, isAllowedOrigin(origin));
      },
    })
  );

  function readConfig() {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  }

  function writeConfig(next) {
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const resolvedSyncStore = (() => {
    if (syncStore !== undefined || desktopNotifyBridge) return syncStore;
    const permanentStore = createSupabaseSyncStoreFromEnv();
    if (permanentStore) return permanentStore;
    return process.env.NODE_ENV === "production" ? null : createMemorySyncStore();
  })();

  const syncApi = attachV1SyncApi(app, {
    syncStore: resolvedSyncStore,
    credentialPepper,
    requireCredentialPepper:
      process.env.NODE_ENV === "production" && !desktopNotifyBridge,
    now,
  });

  app.get("/ready", async (_req, res) => {
    if (syncApi.reason === "credential_pepper_not_configured") {
      return res.status(503).json({
        ok: false,
        syncStore: "credential_pepper_not_configured",
      });
    }
    if (!resolvedSyncStore) {
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({ ok: false, syncStore: "not_configured" });
      }
      return res.json({ ok: true, syncStore: "local_only" });
    }
    try {
      await resolvedSyncStore.healthCheck();
      return res.json({ ok: true, syncStore: "available" });
    } catch (_error) {
      return res.status(503).json({ ok: false, syncStore: "unavailable" });
    }
  });

  if (!localConfigEnabled) {
    app.all("/config", (_req, res) =>
      res.status(410).json({ error: "legacy_config_endpoint_retired" })
    );
  } else {
  app.get("/config", async (req, res) => {
    if (req.query?.token) {
      return res.status(410).json({ error: "query_tokens_retired" });
    }
    try {
      res.json(readConfig());
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.put("/config", async (req, res) => {
    if (req.query?.token) {
      return res.status(410).json({ error: "query_tokens_retired" });
    }
    try {
      const next = req.body;
      // minimal validation so you don't brick your file
      if (!next || typeof next !== "object") {
        return res.status(400).json({ error: "config must be an object" });
      }
      if (!Array.isArray(next.streamers)) {
        return res.status(400).json({ error: "streamers must be an array" });
      }
      if (next.streamers.length > MAX_NAMES) {
        return res
          .status(400)
          .json({ error: `too many streamers (max ${MAX_NAMES})` });
      }
      if (
        !next.defaultMilestones ||
        typeof next.defaultMilestones !== "object"
      ) {
        return res
          .status(400)
          .json({ error: "defaultMilestones must be an object" });
      }

      // Optional: validate quietHours shape so the watcher + dashboard stay consistent.
      // Supported:
      // - string: "HH:MM-HH:MM" (legacy)
      // - string[]: ["HH:MM-HH:MM", ...] (multi-span)
      if (
        next.quietHours != null &&
        typeof next.quietHours !== "string" &&
        !(
          Array.isArray(next.quietHours) &&
          next.quietHours.every((x) => typeof x === "string")
        )
      ) {
        return res.status(400).json({
          error: 'quietHours must be a string like "HH:MM-HH:MM" or an array of such strings',
        });
      }

      writeConfig(next);
      res.json({ ok: true, config: next });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
  }

  // Fetch paceman world + derive available milestone bases by inspecting data keys.
  app.get("/paceman/milestones", async (req, res) => {
    try {
      const name = String(req.query?.name || "").trim();
      if (!name) return res.status(400).json({ error: "name is required" });

      const runId = await paceman.getRecentRunId(name, 1);
      if (!runId) return res.json({ ok: true, runId: null, milestones: [] });

      const world = await paceman.getWorld(runId);
      const keys = Object.keys(world?.data || {});
      const bases = new Set();
      for (const k of keys) {
        if (k.endsWith("Rta")) bases.add(k.slice(0, -3));
        // IGT is stored in bare keys, so no "Igt" suffix in getWorld.
      }
      // Include any bare-key splits too
      for (const k of keys) {
        if (!k.endsWith("Rta") && !k.endsWith("Igt")) {
          // heuristic: split keys are lowercase with underscores; ignore metadata keys
          if (/^[a-z_]+$/.test(k)) bases.add(k);
        }
      }
      const milestones = Array.from(bases).sort((a, b) => a.localeCompare(b));
      res.json({ ok: true, runId, milestones });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Lightweight profile endpoint for streamer tiles (avatar sourcing).
  // Example: GET /profiles?names=xQcOW,forsen
  app.get("/profiles", async (req, res) => {
    try {
      const parsed = parseNames(req.query?.names);
      if (!parsed) return res.status(400).json({ error: "names is required" });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { names } = parsed;

      const profiles = {};
      for (const name of names) {
        const key = `profile:${name.toLowerCase()}`;
        const cached = cacheGet(key);
        if (cached) {
          profiles[name] = cached;
          continue;
        }

        const { runId, twitch, uuid } = await resolveStreamerProfile(name);

        // No-auth MVP: use public avatar services.
        // - Twitch profile image: prefer Helix/decapi, fall back to unavatar.
        // - Minecraft head: crafatar supports UUID heads.
        const twitchAvatarUrl = twitch
          ? await fetchTwitchAvatarUrl(twitch)
          : null;
        const avatarUrl =
          twitchAvatarUrl ||
          (twitch
            ? `https://unavatar.io/twitch/${encodeURIComponent(twitch)}`
            : uuid
              ? `https://crafatar.com/avatars/${encodeURIComponent(uuid)}?size=256&overlay`
              : null);

        const value = { runId, twitch, uuid, avatarUrl };
        // Cache hard: avatars don't change often.
        cacheSet(key, value, 6 * 60 * 60 * 1000);
        profiles[name] = value;
      }

      res.json({ ok: true, profiles });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/twitch/status", async (req, res) => {
    try {
      const parsed = parseNames(req.query?.names);
      if (!parsed) return res.status(400).json({ error: "names is required" });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { names } = parsed;

      const statuses = {};
      for (const name of names) {
        const directHandle = normalizeTwitchHandle(name);
        let twitch = null;

        // Fast path: if the caller already provided a normalized lowercase
        // Twitch handle, avoid the extra Paceman identity lookup entirely.
        if (directHandle && directHandle === directHandle.toLowerCase()) {
          twitch = directHandle;
        } else {
          const profile = await resolveStreamerProfile(name);
          twitch = profile?.twitch || directHandle;
        }

        statuses[name] = {
          isTwitchLive: (await fetchTwitchLive(twitch)) === true,
          twitch,
        };
      }

      res.json({ ok: true, statuses });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Lightweight status endpoint for the dashboard streamer tiles.
  // Returns whether each streamer is "active" on Paceman recently, plus run-level isLive.
  // Also returns twitch-live state (best-effort) for UI indicators.
  // Example: GET /status?names=xQcOW,forsen
  app.get("/status", async (req, res) => {
    try {
      const parsed = parseNames(req.query?.names);
      if (!parsed) return res.status(400).json({ error: "names is required" });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { names } = parsed;

      const statuses = {};
      const ACTIVE_WINDOW_SEC = 15 * 60; // "active on paceman" if updated within last 15 min
      const FINISH_GRACE_SEC = 2 * 60; // show Finish briefly even if a new run starts immediately
      const nowSec = Math.floor(Date.now() / 1000);

      // Keep in sync with dashboard's canonical milestones list.
      const CANONICAL_MILESTONES = [
        "nether",
        "bastion",
        "fortress",
        "first_portal",
        "stronghold",
        "end",
        "finish",
      ];
      const LIVE_EVENT_BY_MILESTONE = {
        nether: "rsg.enter_nether",
        bastion: "rsg.enter_bastion",
        fortress: "rsg.enter_fortress",
        first_portal: "rsg.first_portal",
        stronghold: "rsg.enter_stronghold",
        end: "rsg.enter_end",
        finish: "rsg.credits",
      };

      function getSplitMsFromWorldData(world, base) {
        const data = world?.data || {};
        const candidates = [
          data?.[base],
          data?.[`${base}Igt`],
          data?.[`${base}Rta`],
        ];
        for (const v of candidates) {
          if (Number.isFinite(v) && v >= 0) return v;
        }
        return null;
      }

      function getLiveSplitMs(liveRun, milestone) {
        const eventId = LIVE_EVENT_BY_MILESTONE[milestone];
        if (!eventId) return null;
        const event = liveRun?.eventList?.find((e) => e?.eventId === eventId);
        if (!event) return null;
        const candidates = [event?.igt, event?.rta];
        for (const v of candidates) {
          if (Number.isFinite(v) && v >= 0) return v;
        }
        return null;
      }

      function getWorldSplitMsForClock(world, milestone, clock) {
        const data = world?.data || {};
        if (clock === "IGT") {
          const v = data?.[milestone];
          return Number.isFinite(v) && v >= 0 ? v : null;
        }
        if (clock === "RTA") {
          const v = data?.[`${milestone}Rta`];
          return Number.isFinite(v) && v >= 0 ? v : null;
        }
        return null;
      }

      function getLiveSplitMsForClock(liveRun, milestone, clock) {
        const eventId = LIVE_EVENT_BY_MILESTONE[milestone];
        if (!eventId) return null;
        const event = liveRun?.eventList?.find((e) => e?.eventId === eventId);
        if (!event) return null;
        if (clock === "IGT") {
          return Number.isFinite(event?.igt) && event.igt >= 0
            ? event.igt
            : null;
        }
        if (clock === "RTA") {
          return Number.isFinite(event?.rta) && event.rta >= 0
            ? event.rta
            : null;
        }
        return null;
      }

      function getSplitMsForClock(world, liveRun, milestone, clock) {
        const worldMs = getWorldSplitMsForClock(world, milestone, clock);
        if (worldMs != null) return worldMs;
        return getLiveSplitMsForClock(liveRun, milestone, clock);
      }

      function normalizeNick(value) {
        return String(value || "").trim().toLowerCase();
      }

      function toNameList(value) {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
      }

      function findLiveRunForStreamer(liveRuns, names) {
        const targets = new Set(
          toNameList(names).map(normalizeNick).filter(Boolean)
        );
        if (!targets.size) return null;
        return (
          (liveRuns || []).find((run) => {
            const nick = normalizeNick(
              run?.nickname ||
                run?.user?.nickname ||
                run?.user?.nick ||
                run?.user?.displayName
            );
            return nick && targets.has(nick);
          }) || null
        );
      }

      function normalizeUpdatedSec(value) {
        if (!Number.isFinite(value) || value <= 0) return null;
        // Paceman live runs can return ms; normalize to seconds.
        return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
      }

      function getLastMilestone(world, liveRun) {
        let lastMilestone = null;
        let lastMilestoneMs = null;
        let lastMilestoneSource = null;
        for (const m of CANONICAL_MILESTONES) {
          const worldMs = getSplitMsFromWorldData(world, m);
          const liveMs = getLiveSplitMs(liveRun, m);
          const ms = worldMs ?? liveMs;
          if (ms != null && (lastMilestoneMs == null || ms >= lastMilestoneMs)) {
            lastMilestone = m;
            lastMilestoneMs = ms;
            lastMilestoneSource = worldMs != null ? "world" : "live";
          }
        }
        return { lastMilestone, lastMilestoneMs, lastMilestoneSource };
      }

      let liveRuns = null;
      if (typeof paceman.getLiveRuns === "function") {
        try {
          liveRuns = await paceman.getLiveRuns();
        } catch (_e) {
          liveRuns = null;
        }
      }

      for (const name of names) {
        const key = `status:${name.toLowerCase()}`;
        const cached = cacheGet(key);
        if (cached) {
          statuses[name] = cached;
          continue;
        }

        let runId = null;
        let prevRunId = null;
        let isLive = false;
        let isActive = false;
        let runIsActive = false;
        let lastUpdatedSec = null;
        let runStartSec = null;
        let lastMilestone = null;
        let lastMilestoneMs = null;
        let lastMilestoneSource = null;
        let recentFinishUpdatedSec = null;
        let recentFinishMs = null;
        let splits = null;
        let twitchLive = null;
        let twitchHandle = null;
        try {
          if (typeof paceman.getRecentRuns === "function") {
            const runs = await paceman.getRecentRuns(name, 2);
            runId = runs?.[0]?.id ?? null;
            prevRunId = runs?.[1]?.id ?? null;
          } else {
            runId = await paceman.getRecentRunId(name, 1);
          }
          if (runId) {
            const world = await paceman.getWorld(runId);
            const rawTwitch =
              typeof world?.data?.twitch === "string" &&
              world.data.twitch.trim()
                ? world.data.twitch.trim()
                : null;
            twitchHandle = normalizeTwitchHandle(rawTwitch);
            isLive = !!world?.isLive;
            // Paceman's isLive is run-level ("in liveruns") and can go false even while a runner is still playing.
            // For a more human-friendly "active" signal, we treat "recently updated" as active.
            lastUpdatedSec =
              (Number.isFinite(world?.data?.updateTime) &&
              world?.data?.updateTime > 0
                ? world.data.updateTime
                : null) ?? null;
            runStartSec =
              (Number.isFinite(world?.data?.insertTime) &&
              world?.data?.insertTime > 0
                ? world.data.insertTime
                : null) ?? null;
            isActive =
              isLive ||
              (typeof lastUpdatedSec === "number" &&
                nowSec - lastUpdatedSec <= ACTIVE_WINDOW_SEC);
            // For now, keep runIsActive identical to isActive (no additional "freshness" suppression).
            runIsActive = isActive;

            const liveRun = findLiveRunForStreamer(liveRuns, [
              name,
              world?.data?.nickname,
              world?.data?.twitch,
              twitchHandle,
            ]);
            if (liveRun) {
              isLive = true;
              isActive = true;
              runIsActive = true;
            }

            const last = getLastMilestone(world, liveRun);
            lastMilestone = last.lastMilestone;
            lastMilestoneMs = last.lastMilestoneMs;
            lastMilestoneSource = last.lastMilestoneSource;
            const splitMap = {};
            for (const m of CANONICAL_MILESTONES) {
              splitMap[m] = {
                igt: getSplitMsForClock(world, liveRun, m, "IGT"),
                rta: getSplitMsForClock(world, liveRun, m, "RTA"),
              };
            }
            splits = splitMap;
            if (lastMilestoneSource === "live") {
              const liveUpdatedSec = normalizeUpdatedSec(liveRun?.lastUpdated);
              if (liveUpdatedSec != null) lastUpdatedSec = liveUpdatedSec;
            }

            // If they finished and instantly started a new run, the latest run won't have "finish".
            // In that case, surface a brief "recentFinish" signal from the previous run.
            if (lastMilestone !== "finish" && prevRunId) {
              const prevWorld = await paceman.getWorld(prevRunId);
              const prevFinishMs = getSplitMsFromWorldData(prevWorld, "finish");
              const prevUpdatedSec =
                Number.isFinite(prevWorld?.data?.updateTime) &&
                prevWorld.data.updateTime > 0
                  ? prevWorld.data.updateTime
                  : null;
              if (
                prevFinishMs != null &&
                typeof prevUpdatedSec === "number" &&
                nowSec - prevUpdatedSec <= FINISH_GRACE_SEC
              ) {
                recentFinishMs = prevFinishMs;
                recentFinishUpdatedSec = prevUpdatedSec;
              }
            }
          }
        } catch (e) {
          // Per-name failures should not break the entire response.
          runId = null;
          isLive = false;
          isActive = false;
          runIsActive = false;
          lastUpdatedSec = null;
          runStartSec = null;
          lastMilestone = null;
          lastMilestoneMs = null;
          lastMilestoneSource = null;
          recentFinishUpdatedSec = null;
          recentFinishMs = null;
          splits = null;
        }

        try {
          const handleForLive = twitchHandle || name;
          twitchLive = await fetchTwitchLive(handleForLive);
        } catch {
          twitchLive = null;
        }

        const value = {
          runId,
          isLive,
          isActive,
          runIsActive,
          isTwitchLive: twitchLive === true,
          twitch: twitchHandle,
          lastUpdatedSec,
          runStartSec,
          lastMilestone,
          lastMilestoneMs,
          lastMilestoneSource,
          splits,
          recentFinishMs,
          recentFinishUpdatedSec,
        };
        // Keep roughly in sync with the dashboard polling interval so UI updates feel live.
        cacheSet(key, value, 5_000);
        statuses[name] = value;
      }

      res.json({ ok: true, statuses });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Simple “is desktop notifications wired up?” endpoint.
  app.post("/notify/test", async (req, res) => {
    try {
      const title = String(req.body?.title || "runAlert test");
      const message = String(
        req.body?.message || "Desktop notifications are working."
      );
      await notifySend({ channel: "desktop", title, message });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  if (desktopNotifyBridge) {
    app.post("/notify", async (req, res) => {
      try {
        const title = String(req.body?.title || "runAlert");
        const message = String(req.body?.message || "");
        const openUrl =
          typeof req.body?.openUrl === "string" && req.body.openUrl.trim()
            ? req.body.openUrl.trim()
            : undefined;
        const sound = req.body?.sound !== false;
        await notifySend({
          channel: "desktop",
          title,
          message,
          openUrl,
          sound,
        });
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
      }
    });
  }

  function stableReleaseManifest() {
    if (releaseManifest) {
      return { ...releaseManifest, channel: "stable" };
    }
    const macDmgUrl = String(process.env.RUNALERT_MAC_DMG_URL || "").trim();
    const macZipUrl = String(process.env.RUNALERT_MAC_ZIP_URL || "").trim();
    const windowsStoreUrl = String(
      process.env.RUNALERT_WINDOWS_STORE_URL || ""
    ).trim();
    return {
      channel: "stable",
      version: require("../../package.json").version,
      publishedAt: process.env.RUNALERT_RELEASE_PUBLISHED_AT || null,
      mac: {
        available: Boolean(macDmgUrl && macZipUrl),
        dmgUrl: macDmgUrl || null,
        zipUrl: macZipUrl || null,
        universal: true,
      },
      windows: {
        available: Boolean(windowsStoreUrl),
        storeUrl: windowsStoreUrl || null,
      },
    };
  }

  app.get("/api/releases/stable", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json(stableReleaseManifest());
  });

  app.get(
    [
      "/install/macos.command",
      "/install/windows.ps1",
      "/download/macos/dmg",
      "/download/macos/zip",
      "/download/windows/exe",
    ],
    (_req, res) => {
      res.status(410).json({
        error: "legacy_installer_retired",
        message: "Use destinations from /api/releases/stable.",
      });
    }
  );

  const dashboardDist = path.join(__dirname, "../../dashboard/dist");
  const dashboardIndex = path.join(dashboardDist, "index.html");
  if (fs.existsSync(dashboardIndex)) {
    app.use(express.static(dashboardDist));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(dashboardIndex);
    });
  }

  app.use(apiErrorHandler);

  return app;
}

function startServer(port = 8787) {
  const resolvedPort = (() => {
    const envPort = Number.parseInt(process.env.PORT || "", 10);
    if (Number.isFinite(envPort) && envPort > 0) return envPort;
    return port;
  })();
  const app = createApp();
  app.listen(resolvedPort, () => {
    console.log(`[api] listening on http://localhost:${resolvedPort}`);
  });
}

module.exports = { createApp, startServer, defaultIsAllowedOrigin };
