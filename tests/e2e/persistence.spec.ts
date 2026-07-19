import { expect, test, type Page } from "@playwright/test";

const WALL_START = new Date("2030-01-01T12:00:00.000Z");
const WALL_READY = new Date("2030-01-01T12:30:00.000Z");
const WALL_DUE = new Date("2030-01-01T13:30:00.000Z");
const PLANNER_STORAGE_KEY = "dinnersync:planner:v1";

async function openCookScreen(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the 650 kcal demo" }).click();
  await page.getByRole("button", { name: /build the service timeline/i }).click();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect.poll(() => page.evaluate(
    (key) => localStorage.getItem(key),
    PLANNER_STORAGE_KEY,
  )).toContain('"stage":"cook"');
}

test("refresh restores running and derives due without auto-completing", async ({ page }) => {
  await page.clock.install({ time: WALL_START });
  await openCookScreen(page);

  await page.clock.setSystemTime(WALL_READY);
  await page.reload();
  const start = page.getByRole("button", { name: /^Start / }).first();
  await expect(start).toBeEnabled();
  const startLabel = await start.getAttribute("aria-label");
  if (!startLabel?.startsWith("Start ")) throw new Error("Expected an accessible Start label");
  const taskName = startLabel.slice("Start ".length);
  await start.click();
  await expect(page.getByRole("button", { name: `Complete ${taskName}` })).toBeEnabled();
  await expect.poll(() => page.evaluate(
    (key) => localStorage.getItem(key),
    PLANNER_STORAGE_KEY,
  )).toContain("TASK_STARTED");

  await page.reload();
  let taskCard = page.getByRole("article", { name: taskName });
  await expect(taskCard.getByText("Running", { exact: true })).toBeVisible();
  await expect(taskCard.getByText(/remaining/i)).toBeVisible();
  await expect(taskCard.getByRole("button", { name: `Complete ${taskName}` })).toBeEnabled();
  await expect(page.getByRole("status", { name: "Cooking session warnings" }))
    .toContainText(/restored.*saved cooking session/i);

  await page.clock.setSystemTime(WALL_DUE);
  await page.reload();
  taskCard = page.getByRole("article", { name: taskName });
  await expect(taskCard.getByText("Due · resource held", { exact: true })).toBeVisible();
  await expect(taskCard.getByText(/overdue/i)).toBeVisible();
  await expect(taskCard.getByRole("button", { name: `Complete ${taskName}` })).toBeEnabled();
  await expect(taskCard.getByText("Completed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /dinner landed.*here is the record/i }))
    .toHaveCount(0);
});
