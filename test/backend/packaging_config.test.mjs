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

describe("desktop packaging configuration", () => {
  it("builds the Windows beta for mainstream x64 PCs on every host", () => {
    expect(packageJson.scripts["electron:pack:win"]).toContain("--x64");
  });

  it("marks packaged Mac artifacts as requiring notarization", () => {
    expect(packageJson.scripts["electron:pack:mac"]).toContain(
      "RUNALERT_REQUIRE_NOTARIZATION=1"
    );
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
