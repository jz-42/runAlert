import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const require = createRequire(import.meta.url);
const notarizeMac = require("../../scripts/notarize-mac.js");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").trim();
}

describe("desktop packaging configuration", () => {
  it("pins the v1 toolchain to Node 24 everywhere", () => {
    expect(packageJson.version).toBe("1.0.0");
    expect(packageJson.engines.node).toMatch(/^>=24\./);
    expect(read(".node-version")).toMatch(/^24\./);
    expect(read(".nvmrc")).toBe(read(".node-version"));
    expect(read("dashboard/package.json")).toContain('"node": ">=24.');
    expect(read(".github/workflows/ci.yml")).toContain("node-version: 24");
    expect(read("render.yaml")).toContain("NODE_VERSION");
  });

  it("builds the Microsoft Store package for mainstream x64 PCs", () => {
    expect(packageJson.scripts["electron:pack:win"]).toContain("--x64");
    expect(packageJson.scripts["electron:pack:win"]).toContain("appx");
    expect(packageJson.build.win.target).toContain("appx");
  });

  it("builds universal Mac artifacts and requires notarization", () => {
    expect(packageJson.devDependencies["@electron/notarize"]).toBeTruthy();
    expect(packageJson.scripts["electron:pack:mac"]).toContain(
      "RUNALERT_REQUIRE_NOTARIZATION=1"
    );
    expect(packageJson.scripts["electron:pack:mac"]).toContain("--universal");
    expect(packageJson.build.mac.target).toEqual(["dmg", "zip"]);
  });

  it("registers the runalert pairing protocol in desktop packages", () => {
    expect(packageJson.build.protocols).toContainEqual(
      expect.objectContaining({ schemes: ["runalert"] })
    );
  });

  it("ships a clean new-user config", () => {
    const config = JSON.parse(read("config.json"));
    expect(config.streamers).toEqual([]);
    expect(config.profiles).toEqual({});
  });

  it("fails a required Mac release when notarization credentials are absent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "runalert-notary-"));
    fs.mkdirSync(path.join(tempDir, "runAlert.app"));
    const envKeys = [
      "RUNALERT_REQUIRE_NOTARIZATION",
      "APPLE_NOTARYTOOL_KEYCHAIN_PROFILE",
      "NOTARYTOOL_KEYCHAIN_PROFILE",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ];
    const previousEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]])
    );

    try {
      process.env.RUNALERT_REQUIRE_NOTARIZATION = "1";
      for (const key of envKeys.slice(1)) delete process.env[key];

      await expect(
        notarizeMac({
          electronPlatformName: "darwin",
          appOutDir: tempDir,
          packager: { appInfo: { productFilename: "runAlert" } },
        })
      ).rejects.toThrow(/notarization credentials are required/i);
    } finally {
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
