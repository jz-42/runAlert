import { beforeEach, describe, expect, it, vi } from "vitest";

describe("analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete (window as any).runAlertAnalytics;
  });

  it("does nothing when analytics is not configured", async () => {
    const { trackEvent } = await import("./analytics");

    const result = await trackEvent("app_download_clicked", {
      surface: "browser",
    });

    expect(result).toBe(false);
  });

  it("captures anonymous events when configured", async () => {
    (window as any).runAlertAnalytics = {
      posthogKey: "ph_test_key",
      host: "https://app.posthog.com",
    };
    const sendBeaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconMock,
    });

    const { getDistinctId, trackEvent } = await import("./analytics");
    const firstId = getDistinctId();

    window.history.replaceState(
      {},
      "",
      "/settings?token=permanent-secret&exchange=pair-secret"
    );

    const result = await trackEvent("streamer_added", {
      streamer: "xQcOW",
      pairingCode: "ABCD-EFGH",
      configToken: "permanent-secret",
      surface: "browser",
      reason: undefined,
    });

    expect(result).toBe(true);
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeaconMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://app.posthog.com/capture/");
    expect(typeof body).toBe("string");
    const payload = JSON.parse(String(body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      api_key: "ph_test_key",
      event: "streamer_added",
      properties: {
        surface: "browser",
        $current_url: "http://localhost:3000/settings",
        $lib: "runalert-web",
      },
    });
    expect(typeof payload.distinct_id).toBe("string");
    expect(payload.distinct_id).toBe(firstId);

    const secondId = getDistinctId();
    expect(secondId).toBe(firstId);
    expect(window.localStorage.getItem("runalert-analytics-distinct-id")).toBe(
      firstId
    );
    expect(String(body)).not.toContain("xQcOW");
    expect(String(body)).not.toContain("ABCD-EFGH");
    expect(String(body)).not.toContain("permanent-secret");
  });
});
