import { expect, type Locator, type Page } from '@playwright/test';

export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  tablet: Object.freeze({ width: 768, height: 1024 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

export const DEMOS = Object.freeze([
  { id: 'IV-EXP1', title: 'Original three-bit counter', cords: 44 },
  { id: 'ER-ALTCOUNTER', title: 'SDC alternate three-bit counter', cords: 48 },
  { id: 'VI-TICTACTOE', title: 'Tic-Tac-Toe', cords: 72 },
  { id: 'V-JOBSELECT', title: 'Mate Selection', cords: 30 },
  { id: 'VI-RANDOM', title: 'Four-sided die', cords: 40 },
  { id: 'III-RELAYAND', title: 'Relay AND', cords: 10 },
  { id: 'III-RELAYOR', title: 'Relay OR', cords: 11 },
  { id: 'III-RELAYNOT', title: 'Relay NOT', cords: 6 },
  { id: 'III-RELAYXOR', title: 'Relay XOR', cords: 11 },
  { id: 'V-EXP2', title: 'Burglar Alarm', cords: 16 },
  { id: 'IV-FF2', title: 'Two-relay flip-flop', cords: 14 },
  { id: 'V-EXP4', title: 'Traffic Light', cords: 22 },
  { id: 'VI-SPS', title: 'Scissors, Paper or Stone', cords: 41 },
  { id: 'VI-COMBOLOCK', title: 'Combination Lock', cords: 46 },
  { id: 'V-EXP19', title: 'Morse Code Encoder', cords: 49 },
  { id: 'VI-REACTION', title: 'Reaction Time Tester', cords: 51 },
  { id: 'IV-EXP4', title: 'Half-Adder', cords: 8 },
]);

export const COUNTER_NOTICE = Object.freeze([
  'SDC supplied a second wiring for this counter.',
  "SDC's errata warns that Book IV's three-bit counter can strain the relays, and adds bypass paths so the relay coils receive full voltage and pull in more reliably. Both published wirings are included here.",
  "The simulator's six relay thresholds use an unmeasured fallback. The available evidence does not establish why the physical counter was marginal, and this simulation does not claim to reproduce that cause.",
]);

export async function openConsole(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.console-surface')).toBeVisible();
  await expect(page.locator('.command-status')).toContainText('Ready.');
  const closeHelp = page.getByRole('button', { name: 'Close help' });
  if (await closeHelp.isVisible()) await closeHelp.click();
}

export async function closeDrawer(page: Page): Promise<void> {
  const drawer = page.locator('.console-drawer');
  if (await drawer.isVisible()) {
    await page.getByRole('button', { name: 'Library & diagnostics' }).click();
  }
  await expect(drawer).toBeHidden();
}

export async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    }));
  });
}

export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

export async function expectAligned(a: Locator, b: Locator, tolerance = 1): Promise<void> {
  const [aCenter, bCenter] = await Promise.all([center(a), center(b)]);
  expect(Math.abs(aCenter.x - bCenter.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(aCenter.y - bCenter.y)).toBeLessThanOrEqual(tolerance);
}

export async function firstConnectedEndpoint(page: Page): Promise<{
  handle: Locator;
  hole: Locator;
}> {
  const row = page.locator('.cord-row').first();
  const endpointText = (await row.locator('.cord-end').first().innerText()).trim();
  const match = /^A: (.+#\d+)$/u.exec(endpointText);
  expect(match).not.toBeNull();
  return {
    handle: page.locator('.cord-handle[data-cord="0"][data-side="a"]'),
    hole: page.locator('.panel-hole[data-hole="' + match![1] + '"]'),
  };
}
