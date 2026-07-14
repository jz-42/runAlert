const DEFAULT_MILESTONES = Object.freeze({
  nether: Object.freeze({ thresholdSec: 240, enabled: true }),
  bastion: Object.freeze({ thresholdSec: 360, enabled: true }),
  fortress: Object.freeze({ thresholdSec: 540, enabled: true }),
  first_portal: Object.freeze({ thresholdSec: 720, enabled: true }),
  stronghold: Object.freeze({ thresholdSec: 825, enabled: true }),
  end: Object.freeze({ thresholdSec: 840, enabled: true }),
  finish: Object.freeze({ thresholdSec: 900, enabled: true }),
});

const DEFAULT_CONFIG = Object.freeze({
  streamers: Object.freeze([]),
  clock: "IGT",
  quietHours: Object.freeze([]),
  notifications: Object.freeze({ enabled: true, sound: true }),
  agent: Object.freeze({ autoUpdate: true, backgroundMonitoring: false }),
  channels: Object.freeze(["desktop"]),
  defaultMilestones: DEFAULT_MILESTONES,
  profiles: Object.freeze({}),
});

function createDefaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_MILESTONES,
  createDefaultConfig,
};
