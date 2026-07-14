import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const config = {
  streamers: ["Feinberg"],
  clock: "IGT",
  quietHours: [],
  notifications: { enabled: true, sound: true },
  agent: { autoUpdate: true, backgroundMonitoring: false },
  channels: ["desktop"],
  defaultMilestones: {
    nether: { thresholdSec: 240, enabled: true },
    bastion: { thresholdSec: 360, enabled: true },
    fortress: { thresholdSec: 540, enabled: true },
    first_portal: { thresholdSec: 720, enabled: true },
    stronghold: { thresholdSec: 825, enabled: true },
    end: { thresholdSec: 840, enabled: true },
    finish: { thresholdSec: 900, enabled: true },
  },
  profiles: {},
};

async function mockApp(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "runalert-device-credential-v1",
      "ra1_accessibility-test-credential"
    );
    window.localStorage.setItem("runalert-onboarding-dismissed", "true");
  });
  await page.route("**/api/config/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: connected\ndata: {"type":"connected"}\n\n',
    })
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) })
  );
  await page.route("**/api/releases/stable", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "1.0.0",
        mac: { available: false },
        windows: { available: false },
      }),
    })
  );
  await page.route("**/profiles?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profiles: { Feinberg: { avatarUrl: null } } }),
    })
  );
  await page.route("**/status?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"statuses":{}}' })
  );
}

test("core dashboard has no automated WCAG A/AA violations @a11y", async ({ page }) => {
  await mockApp(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("Feinberg")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("settings are keyboard reachable and reduced motion is honored @a11y", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApp(page);
  await page.goto("/", { waitUntil: "networkidle" });

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const reducedDuration = await page.locator("button").first().evaluate(
    (button) => getComputedStyle(button).transitionDuration
  );
  expect(Number.parseFloat(reducedDuration)).toBeLessThanOrEqual(0.00001);
});
