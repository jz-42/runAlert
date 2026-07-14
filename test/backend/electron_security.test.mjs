import { describe, expect, it } from "vitest";

import navigation from "../../electron/navigation_policy.js";
import localApi from "../../electron/local_api.js";

const { isAllowedExternalUrl, isAllowedRendererNavigation } = navigation;

describe("Electron security policy", () => {
  it("uses a dynamic loopback port", () => {
    expect(localApi.DEFAULT_PORT).toBe(0);
  });

  it("allows only known HTTPS external destinations", () => {
    expect(isAllowedExternalUrl("https://twitch.tv/feinberg")).toBe(true);
    expect(isAllowedExternalUrl("https://paceman.gg/stats/player/foo")).toBe(true);
    expect(isAllowedExternalUrl("https://github.com/jz-42/runAlert")).toBe(true);
    expect(isAllowedExternalUrl("http://twitch.tv/feinberg")).toBe(false);
    expect(isAllowedExternalUrl("https://evil.example/?next=twitch.tv")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
  });

  it("keeps renderer navigation on its exact local origin", () => {
    const origin = "http://127.0.0.1:49152";
    expect(isAllowedRendererNavigation(`${origin}/settings`, origin)).toBe(true);
    expect(isAllowedRendererNavigation("https://runalert.app", origin)).toBe(false);
    expect(isAllowedRendererNavigation("http://127.0.0.1:49153", origin)).toBe(false);
  });
});
