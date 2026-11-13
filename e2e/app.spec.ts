import { expect, test } from "@playwright/test";

const SCHEDULED = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \w{3} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/;

test("a new task is placed on the calendar and can be completed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Reply to investor email").first()).toBeVisible();

  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill("E2E write report");
  await page.getByLabel("Hours").fill("1");
  await page.getByLabel("Minutes").selectOption("0");
  await page.getByLabel("Priority").selectOption("1");
  await page.getByRole("button", { name: "Add task" }).click();

  const row = page.getByRole("complementary").getByRole("listitem").filter({ hasText: "E2E write report" });
  await expect(row).toBeVisible();
  // ...and as a block on the calendar grid.
  await expect(page.locator(".ev-block", { hasText: "E2E write report" }).first()).toBeVisible();
  await expect(row).toContainText(SCHEDULED);
  await expect(row).toContainText("Urgent");

  await page.getByRole("checkbox", { name: 'Complete "E2E write report"' }).click();
  await expect(page.getByRole("checkbox", { name: 'Mark "E2E write report" as not done' })).toBeVisible();
});

test("tasks page lists scheduled and repeating tasks", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await expect(page.getByText(/Repeating · 1/)).toBeVisible();
  await expect(page.getByText("Mon, Wed, Fri")).toBeVisible();
});

test("projects show progress and settings can be saved", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Website launch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Break between blocks (min)").fill("10");
  await page.getByRole("button", { name: "Save and re-plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
});

test("a guest can book a slot and the owner sees it", async ({ page }) => {
  await page.goto("/book/intro");
  await expect(page.getByRole("heading", { name: "Intro call" })).toBeVisible();
  const firstSlot = page.getByRole("button", { name: /^\d{1,2}:\d{2} (AM|PM)$/ }).first();
  await firstSlot.click();
  await page.getByLabel("Your name").fill("Pat Guest");
  await page.getByLabel("Email").fill("pat@example.com");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("status")).toContainText("You are booked");

  await page.goto("/settings");
  await expect(page.getByText("Pat Guest")).toBeVisible();

  const res = await page.request.get("/api/book/missing");
  expect(res.status()).toBe(404);
});
