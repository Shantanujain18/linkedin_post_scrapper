import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("built extension has a valid popup and scraper entries", async ({ page }) => {
  const dist = resolve(import.meta.dirname, "../dist");
  const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background.service_worker).toBe("background.js");
  const background = await readFile(resolve(dist, "background.js"), "utf8");
  expect(background).toContain('datePosted');
  expect(background).toContain("past-24h");
  await page.goto(`file://${resolve(dist, "popup.html")}`);
  await expect(page.getByRole("heading", { name: "LinkedIn Post Scraper" })).toBeVisible();
  await expect(page.getByLabel("Search keywords")).toHaveValue("hiring python");
  await expect(page.getByText(/past 24 hours/i)).toBeVisible();
});
