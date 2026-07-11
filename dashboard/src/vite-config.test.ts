// @vitest-environment node

import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config.js";

describe("Vite development proxy", () => {
  it("uses the local API without intercepting install-guide assets", () => {
    const proxy = viteConfig.server?.proxy ?? {};

    expect(Object.keys(proxy)).toContain("/install/");
    expect(Object.keys(proxy)).not.toContain("/install");
    expect(proxy["/install-guide/"]).toBeUndefined();

    for (const route of Object.keys(proxy)) {
      expect(proxy[route]).toMatchObject({
        target: "http://127.0.0.1:8787",
      });
    }
  });
});
