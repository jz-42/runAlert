import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("public product metadata", () => {
  it("ships useful runalert.app search and social metadata", () => {
    const html = fs.readFileSync(path.join(repoRoot, "dashboard/index.html"), "utf8");

    expect(html).toContain("<title>runAlert — Minecraft Speedrun Notifier</title>");
    expect(html).toContain('rel="canonical" href="https://runalert.app/"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="description"');
    expect(html).not.toContain("<title>dashboard</title>");
  });

  it("routes analytics through the sanitized client instead of an injected tracker", () => {
    const entry = fs.readFileSync(
      path.join(repoRoot, "dashboard/src/main.jsx"),
      "utf8"
    );

    expect(entry).not.toContain("VITE_UMAMI");
    expect(entry).not.toContain("document.createElement('script')");
  });

  it("does not duplicate the package version in application source", () => {
    const app = fs.readFileSync(
      path.join(repoRoot, "dashboard/src/App.tsx"),
      "utf8"
    );

    expect(app).not.toMatch(/const APP_VERSION\s*=\s*["']/);
    expect(app).toContain("dashboardPackage.version");
  });

  it("does not ship the beta watcher's Git self-updater", () => {
    const watcher = fs.readFileSync(
      path.join(repoRoot, "src/watcher/run_watcher.js"),
      "utf8"
    );

    expect(watcher).not.toContain("git checkout --detach");
    expect(watcher).not.toContain("npm install --production");
    expect(watcher).not.toContain("RUNALERT_AGENT_CHANNEL");
    expect(watcher).not.toContain("REMOTE_CONFIG_URL");
  });
});
