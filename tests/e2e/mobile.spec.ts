import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > window.innerWidth + 1;
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  }));
  expect(metrics.scrollWidth, `Overflowing elements: ${metrics.offenders.join(", ")}`)
    .toBeLessThanOrEqual(metrics.clientWidth);
}

test("390x844 uses the compact timeline without overflow and keeps primary controls touch-safe", async ({ page }) => {
  await page.goto("/");
  const tryDemo = page.getByRole("button", { name: "Try the 650 kcal demo" });
  await expectTouchTarget(tryDemo);
  await tryDemo.click();

  const buildTimeline = page.getByRole("button", { name: /build the service timeline/i });
  await expectTouchTarget(buildTimeline);
  await buildTimeline.click();

  const compactTimeline = page.getByRole("list", {
    name: "Tasks ordered by start time on compact screens",
  });
  const desktopTimeline = page.getByRole("list", {
    name: "Dish service tracks",
    includeHidden: true,
  });
  await expect(compactTimeline).toBeVisible();
  await expect(desktopTimeline).toBeHidden();
  expect(await compactTimeline.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
  expect(await desktopTimeline.evaluate((element) => getComputedStyle(element).display)).toBe("none");
  await expectNoHorizontalOverflow(page);

  const startCooking = page.getByRole("button", { name: "Start cooking" });
  await expectTouchTarget(startCooking);
  await startCooking.click();
  const replay = page.getByRole("button", { name: /run cooking replay at 60 times speed/i });
  await expectTouchTarget(replay);
  await expectNoHorizontalOverflow(page);
});
