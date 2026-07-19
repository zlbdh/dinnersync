import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  startProductionServer,
  stopProductionServer,
  waitForOwnedServer,
} from "./capture-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = path.join(root, "docs", "submission", "assets");
const port = Number(process.env.DINNERSYNC_CAPTURE_PORT ?? 3_211);
const baseUrl = `http://127.0.0.1:${port}`;
const fixedWallClock = new Date("2026-07-19T09:00:00.000Z");
const auditLog = [];

await mkdir(assets, { recursive: true });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function attachMonitors(page, consoleProblems, prohibitedRequests) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    const localAi = url.pathname.startsWith("/api/local-ai/");
    const externalData = ["fetch", "xhr"].includes(request.resourceType())
      && url.origin !== new URL(baseUrl).origin;
    const modelHost = /(^|\.)(openai\.com|chatgpt\.com|anthropic\.com|mistral\.ai|cohere\.ai)$/.test(
      url.hostname,
    ) || url.hostname === "generativelanguage.googleapis.com";
    if (localAi || externalData || modelHost) prohibitedRequests.push(request.url());
  });
}

async function expectFocused(locator, label) {
  await locator.waitFor({ state: "visible" });
  const focused = await locator.evaluate((element) => document.activeElement === element);
  assert.equal(focused, true, `${label} should receive focus`);
}

async function expectTouchTarget(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert.ok(box, `${label} should have a bounding box`);
  assert.ok(box.width >= 44, `${label} width was ${box.width}px`);
  assert.ok(box.height >= 44, `${label} height was ${box.height}px`);
}

async function auditPage(page, label, touchTargets = []) {
  const layout = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")]
      .map((element) => element.id);
    const duplicateIds = [...new Set(ids.filter(
      (id, index) => ids.indexOf(id) !== index,
    ))];
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      duplicateIds,
    };
  });
  assert.ok(layout.overflow <= 0, `${label} has ${layout.overflow}px horizontal overflow`);
  assert.deepEqual(layout.duplicateIds, [], `${label} has duplicate ids`);
  for (const [locator, targetLabel] of touchTargets) {
    await expectTouchTarget(locator, `${label}: ${targetLabel}`);
  }
  auditLog.push({ label, ...layout, touchTargets: touchTargets.length });
}

async function capture(page, filename) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(assets, filename),
    animations: "disabled",
    caret: "hide",
  });
}

async function openHostedPlan(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const setupTitle = page.getByRole("heading", { name: /set the table for a synced dinner/i });
  await expectFocused(setupTitle, "Setup title");
  const tryDemo = page.getByRole("button", { name: "Try the 650 kcal demo" });
  await auditPage(page, "setup-1440x900", [[tryDemo, "Try demo"]]);
  await capture(page, "setup-1440x900.png");

  await tryDemo.click();
  const reviewTitle = page.getByRole("heading", {
    name: "Review every field before the clock starts.",
  });
  await expectFocused(reviewTitle, "Review title");
  const buildTimeline = page.getByRole("button", { name: /build the service timeline/i });
  await auditPage(page, "review-1440x900", [[buildTimeline, "Build timeline"]]);
  await capture(page, "review-1440x900.png");

  await buildTimeline.click();
  const planTitle = page.getByRole("heading", { name: "Service timeline ready." });
  await expectFocused(planTitle, "Plan title");
  const startCooking = page.getByRole("button", { name: "Start cooking" });
  await auditPage(page, "plan-1440x900", [[startCooking, "Start cooking"]]);
  const tracks = page.getByRole("list", { name: "Dish service tracks" });
  const compact = page.getByRole("list", {
    name: "Tasks ordered by start time on compact screens",
    includeHidden: true,
  });
  assert.equal(await tracks.evaluate((element) => getComputedStyle(element).display), "grid");
  assert.equal(await compact.evaluate((element) => getComputedStyle(element).display), "none");
  await capture(page, "plan-timeline-1440x900.png");
  return { planTitle, startCooking, tracks, compact };
}

async function captureDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleProblems = [];
  const prohibitedRequests = [];
  attachMonitors(page, consoleProblems, prohibitedRequests);
  await page.clock.install({ time: fixedWallClock });

  const plan = await openHostedPlan(page);
  await page.setViewportSize({ width: 1_024, height: 768 });
  await auditPage(page, "plan-1024x768", [[plan.startCooking, "Start cooking"]]);
  assert.equal(await plan.tracks.evaluate((element) => getComputedStyle(element).display), "grid");
  assert.equal(await plan.compact.evaluate((element) => getComputedStyle(element).display), "none");
  await capture(page, "plan-timeline-1024x768.png");

  await page.setViewportSize({ width: 1_440, height: 900 });
  await plan.startCooking.click();
  const cookTitle = page.getByRole("heading", { name: /run the kitchen from what is true now/i });
  await expectFocused(cookTitle, "Cook title");
  const replay = page.getByRole("button", { name: /run cooking replay at 60 times speed/i });
  await expectTouchTarget(replay, "Cook replay");
  await replay.click();
  const moved = page.locator(".task-card__replan").first();
  let delayed = false;
  for (let beat = 0; beat < 40; beat += 1) {
    await page.clock.runFor(25);
    delayed = await page.evaluate(() => {
      const snapshot = localStorage.getItem("dinnersync:planner:v1") ?? "";
      return snapshot.includes("TASK_DELAYED") && snapshot.includes('"delayMinutes":8');
    });
    if (delayed && await moved.isVisible().catch(() => false)) break;
  }
  assert.equal(delayed, true, "Replay should persist the +8 minute delay");
  assert.equal(await moved.isVisible().catch(() => false), true, "Cook should show a replan marker");
  assert.match(await moved.innerText(), /^Replanned · /);
  await moved.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.evaluate(() => window.scrollBy(0, 180));
  await delay(150);
  await auditPage(page, "cook-replanned-1440x900");
  await capture(page, "cook-replanned-1440x900.png");

  await page.clock.runFor(2_000);
  const summaryTitle = page.getByRole("heading", {
    name: /dinner landed.*here is the record/i,
  });
  await expectFocused(summaryTitle, "Summary title");
  await auditPage(page, "summary-1440x900", [[
    page.getByRole("button", { name: "Start another dinner" }),
    "Start another dinner",
  ]]);
  await capture(page, "summary-1440x900.png");

  assert.deepEqual(consoleProblems, [], "Desktop console/page errors were recorded");
  assert.deepEqual(prohibitedRequests, [], "Desktop made a prohibited request");
  await context.close();
}

async function captureMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleProblems = [];
  const prohibitedRequests = [];
  attachMonitors(page, consoleProblems, prohibitedRequests);
  await page.clock.install({ time: fixedWallClock });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Try the 650 kcal demo" }).click();
  await page.getByRole("button", { name: /build the service timeline/i }).click();

  const planTitle = page.getByRole("heading", { name: "Service timeline ready." });
  await expectFocused(planTitle, "Mobile plan title");
  const tracks = page.getByRole("list", { name: "Dish service tracks", includeHidden: true });
  const compact = page.getByRole("list", {
    name: "Tasks ordered by start time on compact screens",
  });
  assert.equal(await tracks.evaluate((element) => getComputedStyle(element).display), "none");
  assert.equal(await compact.evaluate((element) => getComputedStyle(element).display), "grid");
  const startCooking = page.getByRole("button", { name: "Start cooking" });
  await auditPage(page, "mobile-plan-390x844", [[startCooking, "Start cooking"]]);
  await capture(page, "mobile-plan-390x844.png");
  assert.deepEqual(consoleProblems, [], "Mobile console/page errors were recorded");
  assert.deepEqual(prohibitedRequests, [], "Mobile made a prohibited request");
  await context.close();
}

const server = startProductionServer(root, port);
let browser;
try {
  await waitForOwnedServer(server, baseUrl);
  browser = await chromium.launch({ headless: true });
  await captureDesktop(browser);
  await captureMobile(browser);
  console.log(JSON.stringify({ baseUrl, screenshots: 7, audits: auditLog }, null, 2));
} finally {
  await browser?.close();
  stopProductionServer(server);
}
