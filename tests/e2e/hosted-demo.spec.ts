import { expect, test, type Page } from "@playwright/test";

function watchProhibitedRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const isLocalAi = url.pathname.startsWith("/api/local-ai/");
    const isExternalDataRequest = ["fetch", "xhr"].includes(request.resourceType())
      && url.hostname !== "127.0.0.1"
      && url.hostname !== "localhost";
    const isKnownModelHost = /(^|\.)(openai\.com|chatgpt\.com|anthropic\.com|mistral\.ai|cohere\.ai)$/.test(
      url.hostname,
    ) || url.hostname === "generativelanguage.googleapis.com";
    if (isLocalAi || isExternalDataRequest || isKnownModelHost) requests.push(request.url());
  });
  return requests;
}

test("Hosted demo reaches the exact recorded Summary without a model request", async ({ page }) => {
  const prohibitedRequests = watchProhibitedRequests(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Try the 650 kcal demo" }).click();
  const buildTimeline = page.getByRole("button", { name: /build the service timeline/i });
  await expect(buildTimeline).toBeEnabled();
  await buildTimeline.click();

  await expect(page.getByRole("heading", { name: "Service timeline ready." })).toBeFocused();
  await expect(page.getByRole("list", { name: "Dish service tracks" })).toBeVisible();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(page.getByRole("heading", {
    name: /run the kitchen from what is true now/i,
  })).toBeFocused();

  await page.getByRole("button", {
    name: /run cooking replay at 60 times speed/i,
  }).click();
  await expect(page.getByRole("heading", {
    name: /dinner landed.*here is the record/i,
  })).toBeFocused({ timeout: 15_000 });

  const planned = page.getByLabel("Planned dinner completion");
  const actual = page.getByLabel("Actual dinner completion");
  await expect(planned).toHaveText("7:00 PM");
  await expect(actual).toHaveText("7:08 PM");
  await expect(planned).toHaveAttribute("datetime", /T19:00:00\.000Z$/);
  await expect(actual).toHaveAttribute("datetime", /T19:08:00\.000Z$/);
  const plannedInstant = await planned.getAttribute("datetime");
  const actualInstant = await actual.getAttribute("datetime");
  expect(Date.parse(actualInstant!) - Date.parse(plannedInstant!)).toBe(8 * 60_000);
  await expect(page.getByText("8 min late", { exact: true })).toBeVisible();

  const runRecord = page.getByRole("group", { name: "Run record" });
  await expect(runRecord.getByText("Recorded delays").locator("..")).toContainText("1");
  await expect(runRecord.getByText("Delay minutes").locator("..")).toContainText("8");
  await expect(runRecord.getByText("Replan passes", { exact: true }).locator(".."))
    .toContainText("25");
  const advice = page.getByRole("note", { name: "Next service note" });
  await expect(advice).toContainText("Roast the chicken at 200 C");
  await expect(advice).toContainText("8 min");
  expect(prohibitedRequests).toEqual([]);
});
