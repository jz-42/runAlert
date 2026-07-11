import { test, expect } from "@playwright/test";

function mockDashboardApi(page: import("@playwright/test").Page) {
  const streamers = Array.from({ length: 13 }, (_, i) => String(i + 1));

  page.route(/\/config(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        streamers,
        clock: "IGT",
        quietHours: [],
        defaultMilestones: { nether: { thresholdSec: 240, enabled: true } },
        profiles: {},
      }),
    });
  });

  page.route("**/profiles?*", async (route) => {
    const profiles: Record<string, any> = {};
    for (const s of streamers) profiles[s] = { avatarUrl: null };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profiles }),
    });
  });

  page.route("**/status?*", async (route) => {
    const statuses: Record<string, any> = {};
    for (const s of streamers) {
      statuses[s] = {
        runId: null,
        isLive: false,
        isActive: false,
        runIsActive: false,
        lastMilestone: null,
        lastMilestoneMs: null,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, statuses }),
    });
  });
}

test.describe("dashboard visual layout", () => {
  test("mobile keeps header and download actions inside the viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    mockDashboardApi(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("runalert-onboarding-dismissed", "true");
    });

    await page.goto("/", { waitUntil: "networkidle" });

    const layout = await page.evaluate(() => {
      const elements = [
        ["title", document.querySelector(".appTitle")],
        ["settings", document.querySelector(".settingsGear")],
        ...Array.from(
          document.querySelectorAll(".downloadHubActions .installButton")
        ).map((element, index) => [`download-${index}`, element]),
      ] as const;
      const boxes = elements.map(([name, element]) => ({
        name,
        rect: element?.getBoundingClientRect(),
      }));

      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        boxes,
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    for (const box of layout.boxes) {
      expect(box.rect, `${box.name} is present`).toBeTruthy();
      expect(box.rect!.left, `${box.name} starts inside viewport`).toBeGreaterThanOrEqual(0);
      expect(box.rect!.right, `${box.name} ends inside viewport`).toBeLessThanOrEqual(
        layout.viewportWidth
      );
    }
  });

  for (const { name, width, height } of [
    { name: "desktop-1280", width: 1280, height: 800 },
    { name: "desktop-1512", width: 1512, height: 900 },
    { name: "desktop-1920", width: 1920, height: 1080 },
  ]) {
    test(`${name} layout snapshot @visual`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      mockDashboardApi(page);
      await page.context().grantPermissions(["notifications"]);
      await page.addInitScript(() => {
        window.localStorage.setItem("runalert-onboarding-dismissed", "true");
      });

      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.locator(".grid")).toBeVisible();
      await page.waitForTimeout(100);

      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
      });
    });
  }
});
