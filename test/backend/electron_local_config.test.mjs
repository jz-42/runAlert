import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import localApi from "../../electron/local_api.js";

const { ensureLocalConfig } = localApi;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "runalert-electron-"));
}

function writeBundledConfig(dir, config) {
  const bundledConfigPath = path.join(dir, "config.json");
  fs.writeFileSync(bundledConfigPath, JSON.stringify(config, null, 2) + "\n");
  return bundledConfigPath;
}

describe("electron/local_api", () => {
  it("copies the bundled config into userData on first launch", () => {
    const dir = tmpDir();
    const bundledConfigPath = writeBundledConfig(dir, {
      streamers: ["xQcOW"],
      clock: "IGT",
      quietHours: "",
      defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
      profiles: {},
    });

    const result = ensureLocalConfig({
      userDataPath: path.join(dir, "user-data"),
      bundledConfigPath,
    });

    expect(result.configPath).toBe(path.join(dir, "user-data", "config.json"));
    expect(result.configDir).toBe(path.join(dir, "user-data", "configs"));
    expect(fs.existsSync(result.configPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(result.configPath, "utf8"));
    expect(saved.streamers).toEqual(["xQcOW"]);
  });

  it("keeps an existing user config instead of overwriting it", () => {
    const dir = tmpDir();
    const bundledConfigPath = writeBundledConfig(dir, {
      streamers: ["bundled"],
      defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
    });
    const userDataPath = path.join(dir, "user-data");
    fs.mkdirSync(userDataPath, { recursive: true });
    const existingPath = path.join(userDataPath, "config.json");
    fs.writeFileSync(
      existingPath,
      JSON.stringify({ streamers: ["local-user"], defaultMilestones: {} }, null, 2) +
        "\n"
    );

    const result = ensureLocalConfig({ userDataPath, bundledConfigPath });

    expect(result.configPath).toBe(existingPath);
    const saved = JSON.parse(fs.readFileSync(existingPath, "utf8"));
    expect(saved.streamers).toEqual(["local-user"]);
  });
});
