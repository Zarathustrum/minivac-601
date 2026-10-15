import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMOS, closeDrawer, openConsole } from './console-helpers.ts';

const MM_RLY_WIRES = Object.freeze([
  ['1+#1', '1H#1'],
  ['1+#2', '1L#1'],
  ['2+#1', '1Y#1'],
  ['1X#1', '1E#1'],
  ['1F#1', '1-#1'],
  ['1J#1', '1A#1'],
  ['1B#1', '1-#2'],
  ['1G#1', '2A#1'],
  ['2B#1', '2-#1'],
  ['1N#1', '3A#1'],
  ['3B#1', '3-#1'],
  ['1K#1', '4A#1'],
  ['4B#1', '4-#1'],
] as const);

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await openConsole(page);
});

function terminalOf(hole: string): string {
  return hole.slice(0, hole.lastIndexOf('#'));
}

async function choosePickerHole(page: Page, hole: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: 'Find terminal or hole' });
  await expect(search).toBeFocused();
  await search.fill(terminalOf(hole));
  const row = page.locator(
    '.terminal-picker-row[data-terminal="' + terminalOf(hole) + '"]:not([hidden])',
  );
  await expect(row).toHaveCount(1);
  await row.locator('[data-hole="' + hole + '"]').click();
}

async function addWire(
  page: Page,
  index: number,
  a: string,
  b: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Add free cord' }).click();
  await choosePickerHole(page, a);
  const row = page.locator('.cord-row').nth(index);
  await row.locator('.cord-end').nth(1).click();
  await choosePickerHole(page, b);
  await expect(row.locator('.cord-end')).toHaveText(['A: ' + a, 'B: ' + b]);
}

function outputLamp(page: Page, n: number): Locator {
  return page.locator('[data-component="out-lamp-' + n + '"]');
}

async function expectOutputLamps(page: Page, classes: readonly string[]): Promise<void> {
  for (let index = 0; index < classes.length; index++) {
    await expect(outputLamp(page, index + 1)).toHaveClass(
      new RegExp('(?:^|\\s)' + classes[index] + '(?:\\s|$)', 'u'),
    );
  }
}

test('builds and operates the printed MM-RLY-CHECK from a blank panel', async ({ page }) => {
  const selector = page.getByRole('combobox', { name: 'Select demo' });
  await expect(selector.locator('option')).toHaveCount(17);
  expect(await selector.locator('option').evaluateAll((options) => options.map((option) => (
    option as HTMLOptionElement
  ).value))).toEqual(DEMOS.map(({ id }) => id));

  const manual = page.locator('.demo-manual');
  await manual.click();
  await expect(manual).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cord-row')).toHaveCount(0);
  await expect(page.locator('.cord-path')).toHaveCount(0);
  await expect(selector.locator('option')).toHaveCount(17);

  for (let index = 0; index < MM_RLY_WIRES.length; index++) {
    const [a, b] = MM_RLY_WIRES[index]!;
    await addWire(page, index, a, b);
  }
  await expect(page.locator('.cord-row')).toHaveCount(13);
  await expect(page.locator('.cord-path')).toHaveCount(13);
  await expect(page.locator('.panel-hole.occupied')).toHaveCount(26);

  await closeDrawer(page);
  await page.getByRole('button', { name: 'Power', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Power', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expectOutputLamps(page, ['on', 'off', 'on', 'off']);
  await expect(page.locator('[data-component="relay-lamp-1"]')).toHaveClass(/(?:^|\s)off(?:\s|$)/u);

  const pushbutton = page.getByRole('button', { name: 'Pushbutton 1', exact: true });
  await pushbutton.focus();
  await page.keyboard.down('Enter');
  await expect(pushbutton).toHaveAttribute('aria-pressed', 'true');
  await expectOutputLamps(page, ['off', 'on', 'off', 'on']);
  await expect(page.locator('[data-component="relay-lamp-1"]')).toHaveClass(/(?:^|\s)off(?:\s|$)/u);
  await page.keyboard.up('Enter');
  await expect(pushbutton).toHaveAttribute('aria-pressed', 'false');
  await expectOutputLamps(page, ['on', 'off', 'on', 'off']);

  await setDrawerOpen(page);
  const loadDemo = page.getByRole('button', { name: 'Load selected demo' });
  await loadDemo.focus();
  await page.keyboard.press('Enter');
  await expect(manual).toHaveAttribute('aria-pressed', 'false');
  await expect(selector).toHaveValue('IV-EXP1');
  await expect(page.locator('.cord-path')).toHaveCount(44);
});

async function setDrawerOpen(page: Page): Promise<void> {
  const drawer = page.locator('.console-drawer');
  if (!await drawer.isVisible()) {
    await page.getByRole('button', { name: 'Library & diagnostics' }).click();
  }
  await expect(drawer).toBeVisible();
}

test('keeps public Touch momentary and electrically loose after release', async ({ page }) => {
  await page.locator('.demo-manual').click();
  await page.getByRole('button', { name: 'Add free cord' }).click();

  const search = page.getByRole('searchbox', { name: 'Find terminal or hole' });
  await search.fill('1+');
  const touch = page.locator('.terminal-picker-row[data-terminal="1+"] [data-touch="1+"]');
  const bounds = await touch.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await expect(touch).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cord-row').first().locator('.cord-end').first()).toHaveText('A: touch:1+');
  await expect(page.locator('.command-status')).toHaveText('Touching terminal 1+.');

  await page.mouse.up();
  await expect(touch).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.cord-row').first().locator('.cord-end')).toHaveText(['A: free', 'B: free']);
  await expect(page.locator('.panel-hole.occupied')).toHaveCount(0);
  await expect(page.locator('.cord-tray-slot')).toHaveCount(2);
});
