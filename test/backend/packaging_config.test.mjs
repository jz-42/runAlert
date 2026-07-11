import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);

describe("desktop packaging configuration", () => {
  it("builds the Windows beta for mainstream x64 PCs on every host", () => {
    expect(packageJson.scripts["electron:pack:win"]).toContain("--x64");
  });
});
