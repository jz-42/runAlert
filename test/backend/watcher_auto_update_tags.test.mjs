/**
 * Auto-update tag selection tests
 *
 * These lock in channel/tag behavior so agents update safely by release tags,
 * not arbitrary branch heads.
 */

import { describe, it, expect } from "vitest";

import watcher from "../../src/watcher/run_watcher.js";

const {
  normalizeAgentChannel,
  parseVersionTag,
  compareParsedTagVersions,
  pickLatestTagForChannel,
  shouldUpdateToTag,
} = watcher;

describe("watcher auto-update tags", () => {
  it("normalizes channel values to stable|beta", () => {
    expect(normalizeAgentChannel("stable")).toBe("stable");
    expect(normalizeAgentChannel("beta")).toBe("beta");
    expect(normalizeAgentChannel("BETA")).toBe("beta");
    expect(normalizeAgentChannel("")).toBe("stable");
    expect(normalizeAgentChannel("nightly")).toBe("stable");
  });

  it("parses supported tag formats", () => {
    expect(parseVersionTag("v1.2.3")).toMatchObject({
      tag: "v1.2.3",
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
    expect(parseVersionTag("v1.2.3-beta.4")).toMatchObject({
      tag: "v1.2.3-beta.4",
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: { kind: "beta", number: 4 },
    });
    expect(parseVersionTag("main")).toBe(null);
    expect(parseVersionTag("v1.2")).toBe(null);
  });

  it("sorts stable tags above prerelease tags for same version", () => {
    const stable = parseVersionTag("v1.2.3");
    const beta = parseVersionTag("v1.2.3-beta.9");
    expect(compareParsedTagVersions(stable, beta)).toBeGreaterThan(0);
    expect(compareParsedTagVersions(beta, stable)).toBeLessThan(0);
  });

  it("stable channel ignores beta tags", () => {
    const tags = [
      "v1.4.0-beta.2",
      "v1.3.9",
      "v1.4.0-beta.1",
      "v1.3.8",
      "random",
    ];
    expect(pickLatestTagForChannel(tags, "stable")).toBe("v1.3.9");
  });

  it("beta channel picks highest semver across stable+beta tags", () => {
    const tags = [
      "v1.3.9",
      "v1.4.0-beta.2",
      "v1.4.0-beta.3",
      "v1.4.0",
      "v1.2.7",
    ];
    expect(pickLatestTagForChannel(tags, "beta")).toBe("v1.4.0");
  });

  it("shouldUpdateToTag only updates when target is newer", () => {
    expect(shouldUpdateToTag("v1.0.0", "v1.0.1")).toBe(true);
    expect(shouldUpdateToTag("v1.0.1", "v1.0.1")).toBe(false);
    expect(shouldUpdateToTag("v1.2.0", "v1.1.9")).toBe(false);
    expect(shouldUpdateToTag(null, "v1.0.0")).toBe(true);
    expect(shouldUpdateToTag("v1.0.0", "invalid")).toBe(false);
  });
});
