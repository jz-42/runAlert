import { describe, expect, it } from "vitest";

import deepLinks from "../../electron/deep_links.js";

const { findPairingDeepLink, parsePairingDeepLink } = deepLinks;

describe("Electron pairing deep links", () => {
  it("accepts only a short-lived runalert pairing exchange", () => {
    expect(
      parsePairingDeepLink(
        "runalert://pair?exchange=abcdefghijklmnopqrstuvwxyz_0123456789"
      )
    ).toEqual({ exchange: "abcdefghijklmnopqrstuvwxyz_0123456789" });
    expect(parsePairingDeepLink("runalert://pair?credential=ra1_secret")).toBeNull();
    expect(parsePairingDeepLink("https://runalert.app/pair?exchange=abc")).toBeNull();
    expect(parsePairingDeepLink("runalert://other?exchange=abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });

  it("finds a protocol URL in first- or second-instance arguments", () => {
    expect(
      findPairingDeepLink([
        "/Applications/runAlert.app",
        "--flag",
        "runalert://pair?exchange=abcdefghijklmnopqrstuvwxyz_0123456789",
      ])
    ).toEqual({ exchange: "abcdefghijklmnopqrstuvwxyz_0123456789" });
  });
});
