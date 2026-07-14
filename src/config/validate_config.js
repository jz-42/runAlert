const { DEFAULT_MILESTONES } = require("./default_config");

const TOP_LEVEL_KEYS = new Set([
  "streamers",
  "clock",
  "quietHours",
  "notifications",
  "agent",
  "channels",
  "defaultMilestones",
  "profiles",
]);
const MILESTONE_KEYS = new Set(Object.keys(DEFAULT_MILESTONES));
const QUIET_RANGE_RE = /^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateBooleanObject(value, allowedKeys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not allowed`);
    } else if (typeof child !== "boolean") {
      errors.push(`${path}.${key} must be a boolean`);
    }
  }
}

function validateMilestones(value, path, errors, { requireAll = false } = {}) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (requireAll) {
    const missing = Array.from(MILESTONE_KEYS).filter(
      (milestone) => !Object.prototype.hasOwnProperty.call(value, milestone)
    );
    if (missing.length) {
      errors.push(
        `${path} must define every supported milestone (missing: ${missing.join(", ")})`
      );
    }
  }
  for (const [milestone, settings] of Object.entries(value)) {
    if (!MILESTONE_KEYS.has(milestone)) {
      errors.push(`${path}.${milestone} is not a supported milestone`);
      continue;
    }
    if (!isPlainObject(settings)) {
      errors.push(`${path}.${milestone} must be an object`);
      continue;
    }
    for (const key of Object.keys(settings)) {
      if (key !== "thresholdSec" && key !== "enabled") {
        errors.push(`${path}.${milestone}.${key} is not allowed`);
      }
    }
    if (
      settings.thresholdSec != null &&
      (!Number.isInteger(settings.thresholdSec) ||
        settings.thresholdSec < 0 ||
        settings.thresholdSec > 86_400)
    ) {
      errors.push(
        `${path}.${milestone}.thresholdSec must be an integer from 0 to 86400`
      );
    }
    if (settings.enabled != null && typeof settings.enabled !== "boolean") {
      errors.push(`${path}.${milestone}.enabled must be a boolean`);
    }
  }
}

function validateConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    return { ok: false, errors: ["config must be an object"] };
  }

  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key} is not allowed`);
  }

  if (!Array.isArray(config.streamers)) {
    errors.push("streamers must be an array");
  } else {
    if (config.streamers.length > 15) {
      errors.push("streamers must contain at most 15 items");
    }
    const normalized = new Set();
    config.streamers.forEach((streamer, index) => {
      if (
        typeof streamer !== "string" ||
        !streamer.trim() ||
        streamer.length > 50 ||
        /[\u0000-\u001f\u007f]/.test(streamer)
      ) {
        errors.push(`streamers[${index}] must be a non-empty string up to 50 characters`);
        return;
      }
      const key = streamer.trim().toLowerCase();
      if (normalized.has(key)) {
        errors.push(`streamers[${index}] duplicates another streamer`);
      }
      normalized.add(key);
    });
  }

  if (config.clock !== "IGT" && config.clock !== "RTA") {
    errors.push('clock must be "IGT" or "RTA"');
  }

  const quietHours = config.quietHours;
  if (!Array.isArray(quietHours)) {
    errors.push("quietHours must be an array");
  } else {
    if (quietHours.length > 3) errors.push("quietHours must contain at most 3 ranges");
    quietHours.forEach((range, index) => {
      if (typeof range !== "string" || !QUIET_RANGE_RE.test(range)) {
        errors.push(`quietHours[${index}] must use HH:MM-HH:MM in 24-hour time`);
      }
    });
  }

  validateBooleanObject(
    config.notifications,
    new Set(["enabled", "sound"]),
    "notifications",
    errors
  );
  validateBooleanObject(
    config.agent,
    new Set(["autoUpdate", "backgroundMonitoring"]),
    "agent",
    errors
  );

  if (
    !Array.isArray(config.channels) ||
    config.channels.some((channel) => channel !== "desktop") ||
    new Set(config.channels).size !== config.channels.length
  ) {
    errors.push('channels must be an array containing only "desktop"');
  }

  validateMilestones(config.defaultMilestones, "defaultMilestones", errors, {
    requireAll: true,
  });

  if (!isPlainObject(config.profiles)) {
    errors.push("profiles must be an object");
  } else {
    for (const [streamer, milestones] of Object.entries(config.profiles)) {
      if (!streamer.trim() || streamer.length > 50) {
        errors.push("profile names must be non-empty and at most 50 characters");
        continue;
      }
      validateMilestones(milestones, `profiles.${streamer}`, errors);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: config };
}

module.exports = {
  QUIET_RANGE_RE,
  isPlainObject,
  validateConfig,
};
