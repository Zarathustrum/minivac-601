import { expect, test, type Locator, type Page } from '@playwright/test';
import { openConsole } from './console-helpers.ts';

const trace = (page: Page): Locator => page.locator('.trace-text');
const control = (page: Page, id: string): Locator => page.locator(
  '.console-surface button[data-control="' + id + '"], ' +
  '.console-surface input[data-control="' + id + '"]',
);

async function startBlank(page: Page): Promise<void> {
  await setDrawer(page, true);
  const blank = page.getByRole('button', { name: 'Start with a blank panel for manual wiring' });
  await blank.click();
  await expect(blank).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cord-row')).toHaveCount(0);
  await expect(trace(page)).toHaveText('');
}

async function setDrawer(page: Page, open: boolean): Promise<void> {
  const drawer = page.locator('.console-drawer');
  if (await drawer.isVisible() !== open) {
    await page.getByRole('button', { name: 'Library & diagnostics' }).click();
  }
  if (open) await expect(drawer).toBeVisible();
  else await expect(drawer).toBeHidden();
}

async function wireFirstCord(page: Page, a: string, b: string): Promise<void> {
  await page.getByRole('button', { name: 'Add free cord' }).click();
  let picker = page.locator('.terminal-picker');
  await picker.getByRole('button', { name: a, exact: true }).click();
  const row = page.locator('.cord-row').first();
  await row.locator('.cord-end').nth(1).click();
  picker = page.locator('.terminal-picker');
  await picker.getByRole('button', { name: b, exact: true }).click();
}

async function expectTrace(page: Page, text: string): Promise<void> {
  await expect(trace(page)).toContainText(text);
}

test.beforeEach(async ({ page }) => {
  await openConsole(page);
});

test('round-trips drawer focus and operates the boundary hole identities', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Library & diagnostics' });
  const drawer = page.locator('#diagnostics-drawer');
  await expect(toggle).toHaveAttribute('aria-controls', 'diagnostics-drawer');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(drawer).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await startBlank(page);
  const first = page.locator('.panel-hole[data-hole="1A#1"]');
  const last = page.locator('.panel-hole[data-hole="D19#2"]');
  await expect(first).toHaveAttribute('aria-label', '1A#1');
  await expect(last).toHaveAttribute('aria-label', 'D19#2');

  await page.getByRole('button', { name: 'Add free cord' }).click();
  await setDrawer(page, false);
  await first.focus();
  await page.keyboard.press('Enter');
  await setDrawer(page, true);
  const row = page.locator('.cord-row').first();
  await expect(row.locator('.cord-end').first()).toHaveText('A: 1A#1');
  await expect(first).toHaveClass(/occupied/u);
  await expectTrace(page, '> connect cord=0 a=hole:1A#1 b=free');

  await row.locator('.cord-end').nth(1).click();
  await setDrawer(page, false);
  await last.click();
  await setDrawer(page, true);
  await expect(row.locator('.cord-end')).toHaveText(['A: 1A#1', 'B: D19#2']);
  await expect(last).toHaveClass(/occupied/u);
  await expectTrace(page, '> connect cord=0 a=hole:1A#1 b=hole:D19#2');
});

test('operates first and last physical controls with keyboard and pointer semantics', async ({ page }) => {
  await startBlank(page);
  await setDrawer(page, false);

  const power = control(page, 'power');
  const jewel = page.locator('[data-component="power-jewel"]');
  await power.click();
  await expect(power).toHaveAttribute('aria-pressed', 'true');
  await expect(jewel).toHaveAttribute('aria-label', 'Power indicator: lit');
  await expectTrace(page, '> power on');
  await expectTrace(page, '* power off->on');

  const button1 = control(page, 'button1');
  await button1.focus();
  await page.keyboard.down(' ');
  await expect(button1).toHaveAttribute('aria-pressed', 'true');
  await expectTrace(page, '> button1 target=1000');
  await expectTrace(page, 'pb1 mid->no');
  await page.keyboard.up(' ');
  await expect(button1).toHaveAttribute('aria-pressed', 'false');
  await expectTrace(page, '> button1 target=0');
  await expectTrace(page, 'pb1 mid->nc');

  const button6 = control(page, 'button6');
  await button6.hover();
  await page.mouse.down();
  await expect(button6).toHaveAttribute('aria-pressed', 'true');
  await expectTrace(page, '> button6 target=1000');
  await page.mouse.up();
  await expect(button6).toHaveAttribute('aria-pressed', 'false');
  await expectTrace(page, '> button6 target=0');

  const switch1 = control(page, 'switch1');
  await switch1.focus();
  await page.keyboard.press('Enter');
  await expect(switch1).toHaveAttribute('aria-pressed', 'true');
  await expect(switch1).toHaveAttribute('data-travel', '1000');
  await expectTrace(page, '> switch1 target=1000');
  await expectTrace(page, 'sw1 mid->no');

  const switch6 = control(page, 'switch6');
  await switch6.click();
  await expect(switch6).toHaveAttribute('aria-pressed', 'true');
  await expect(switch6).toHaveAttribute('data-travel', '1000');
  await expectTrace(page, '> switch6 target=1000');
  await expectTrace(page, 'sw6 mid->no');

  const relay1 = control(page, 'relay1');
  await relay1.focus();
  await page.keyboard.down('End');
  await expect(relay1).toHaveValue('1000');
  await expectTrace(page, '> relayGrab1 target=1000');
  await expectTrace(page, 'relay1 mid->no');
  await page.keyboard.up('End');
  await expectTrace(page, '> relayRelease1');
  await expect(relay1).toHaveValue('0');
  await expectTrace(page, 'relay1 mid->nc');

  const relay6 = control(page, 'relay6');
  const relayBox = await relay6.boundingBox();
  expect(relayBox).not.toBeNull();
  await page.mouse.move(relayBox!.x + relayBox!.width - 1, relayBox!.y + relayBox!.height / 2);
  await page.mouse.down();
  await expect.poll(async () => Number(await relay6.inputValue())).toBeGreaterThan(900);
  await expectTrace(page, '> relayGrab6 target=');
  await relay6.dispatchEvent('pointercancel', { bubbles: true });
  await expectTrace(page, '> relayRelease6');
  await expect(relay6).toHaveValue('0');
  expect(((await trace(page).textContent()) ?? '').match(/> relayRelease6/gu)).toHaveLength(1);
  await page.mouse.up();
  expect(((await trace(page).textContent()) ?? '').match(/> relayRelease6/gu)).toHaveLength(1);

  const dial = control(page, 'dial');
  const dialBox = await dial.boundingBox();
  expect(dialBox).not.toBeNull();
  const radius = Math.min(dialBox!.width, dialBox!.height) * 0.35;
  for (const contact of [0, 4, 8, 12, 15]) {
    const radians = contact * 22.5 * Math.PI / 180;
    const x = dialBox!.x + dialBox!.width / 2 + Math.sin(radians) * radius;
    const y = dialBox!.y + dialBox!.height / 2 - Math.cos(radians) * radius;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(dial).toHaveAttribute('aria-valuetext', new RegExp('· D' + contact + ' · held$'));
    await page.mouse.up();
    await expect(dial).toHaveAttribute('aria-valuetext', new RegExp('· D' + contact + '$'));
  }
  const traceText = (await trace(page).textContent()) ?? '';
  expect(traceText.match(/> dialGrab targetUdeg=/gu)).toHaveLength(5);
  expect(traceText.match(/> dialRelease/gu)).toHaveLength(5);
  for (const contact of [4, 8, 12, 15]) expect(traceText).toContain('->c' + contact);

  await dial.focus();
  await page.keyboard.press('End');
  await expectTrace(page, '> dialGrab targetUdeg=359999999');
  await expectTrace(page, '> dialRelease');
  await expect(dial).toHaveAttribute('aria-valuetext', /· D15$/u);
});

test('latches two pushbuttons with shift-click until Escape releases both', async ({ page }) => {
  await startBlank(page);
  await setDrawer(page, false);

  const button1 = control(page, 'button1');
  const button2 = control(page, 'button2');
  await button1.click({ modifiers: ['Shift'] });
  await button2.click({ modifiers: ['Shift'] });
  await expect(button1).toHaveAttribute('aria-pressed', 'true');
  await expect(button2).toHaveAttribute('aria-pressed', 'true');
  await expectTrace(page, '> button1 target=1000');
  await expectTrace(page, '> button2 target=1000');
  await expect(trace(page)).not.toContainText('target=0');

  await page.keyboard.press('Escape');
  await expect(button1).toHaveAttribute('aria-pressed', 'false');
  await expect(button2).toHaveAttribute('aria-pressed', 'false');
  await expectTrace(page, '> button1 target=0');
  await expectTrace(page, '> button2 target=0');
});

test('proves the AT-09 POWER jewel trip and reset path through public wiring controls', async ({ page }) => {
  await startBlank(page);
  await setDrawer(page, false);
  const power = control(page, 'power');
  const breaker = control(page, 'breaker');
  const jewel = page.locator('[data-component="power-jewel"]');

  await power.click();
  await expect(power).toHaveAttribute('aria-pressed', 'true');
  await expect(jewel).toHaveClass(/is-lit/u);
  await expect(jewel).toHaveAttribute('aria-label', 'Power indicator: lit');
  await expect(breaker).toBeDisabled();

  await setDrawer(page, true);
  await wireFirstCord(page, '1+#1', '1-#1');
  await expect(jewel).not.toHaveClass(/is-lit/u);
  await expect(jewel).toHaveAttribute('aria-label', 'Power indicator: dark');
  await expect(breaker).toBeEnabled();
  await expectTrace(page, 'breaker ok->tripped');
  await expectTrace(page, '> connect cord=0 a=hole:1+#1 b=hole:1-#1');

  await page.locator('.cord-row').first().locator('.free-end').nth(1).click();
  await setDrawer(page, false);
  await breaker.click();
  await expect(breaker).toBeDisabled();
  await expect(jewel).toHaveClass(/is-lit/u);
  await expect(jewel).toHaveAttribute('aria-label', 'Power indicator: lit');
  await expectTrace(page, '> breaker reset');
  await expectTrace(page, 'breaker tripped->ok');
});
