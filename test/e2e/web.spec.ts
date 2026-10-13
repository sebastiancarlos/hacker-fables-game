import { expect, test } from "@playwright/test";

async function screenText(
  page: import("@playwright/test").Page,
): Promise<string> {
  return page.evaluate(() => window.hackerFables.getScreenText());
}

async function waitForText(
  page: import("@playwright/test").Page,
  text: string,
): Promise<void> {
  await page.waitForFunction((expected: string) => {
    return window.hackerFables.getScreenText().includes(expected);
  }, text);
}

test("shows the title screen without a quit option", async ({ page }) => {
  await page.goto("/");
  await waitForText(page, "HACKER FABLES");
  const text = await screenText(page);
  expect(text).not.toContain("Quit");
});

test("starts a run from the title screen without clicking", async ({
  page,
}) => {
  await page.goto("/");
  await waitForText(page, "HACKER FABLES");
  await page.keyboard.press("n");
  await waitForText(page, "Press any key to begin");
  await page.keyboard.press("Space");
  await waitForText(page, "Dlvl:");
  const text = await screenText(page);
  expect(text).toContain("@");
});
