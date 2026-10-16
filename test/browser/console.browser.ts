import { expect, test, type Locator } from '@playwright/test';
import {
  COUNTER_NOTICE,
  DEMOS,
  closeDrawer,
  expectAligned,
  firstConnectedEndpoint,
  nextPaint,
  openConsole,
} from './console-helpers.ts';

test.beforeEach(async ({ page }) => {
  await openConsole(page);
});

async function expectFocusVisible(control: Locator, ring: Locator = control): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  expect(await ring.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  })).toBe(true);
}

test('keeps the fixed panel geometry contained and aligned', async ({ page }, testInfo) => {
  const surface = page.locator('.console-surface');
  const initial = await surface.boundingBox();
  expect(initial).not.toBeNull();
  expect(initial!.width / initial!.height).toBeGreaterThanOrEqual(1.78);
  expect(initial!.width / initial!.height).toBeLessThanOrEqual(1.82);
  expect(initial!.width).toBeGreaterThan(initial!.height);

  expect(await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    stageOverflow: getComputedStyle(document.querySelector<HTMLElement>('.console-stage')!).overflow,
  }))).toEqual({
    scrollWidth: testInfo.project.use.viewport!.width,
    innerWidth: testInfo.project.use.viewport!.width,
    stageOverflow: 'hidden',
  });

  const geometry = await page.evaluate(() => {
    const surfaceRect = document.querySelector<HTMLElement>('.console-surface')!.getBoundingClientRect();
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const left = rect('[data-plate="left"]');
    const right = rect('[data-plate="upper-right"]');
    const leftPower = rect('[data-band="left/power-stripe"]');
    const rightPower = rect('[data-band="right/power-stripe"]');
    const channelX = Array.from({ length: 6 }, (_, index) => {
      const holeRect = rect('[data-hole="' + (index + 1) + 'A#1"]');
      return (holeRect.left + holeRect.width / 2 - surfaceRect.left) / surfaceRect.width;
    });
    return {
      leftFieldRight: (left.right - surfaceRect.left) / surfaceRect.width,
      rightColumnLeft: (right.left - surfaceRect.left) / surfaceRect.width,
      powerTopDelta: Math.abs(leftPower.top - rightPower.top),
      powerBottomDelta: Math.abs(leftPower.bottom - rightPower.bottom),
      pitches: channelX.slice(1).map((x, index) => x - channelX[index]!),
      pitchPixels: channelX.slice(1).map((x, index) => (
        (x - channelX[index]!) * surfaceRect.width
      )),
    };
  });
  expect(Math.abs(geometry.leftFieldRight - 0.716)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(geometry.rightColumnLeft - 0.728)).toBeLessThanOrEqual(0.01);
  expect(geometry.powerTopDelta).toBeLessThanOrEqual(2);
  expect(geometry.powerBottomDelta).toBeLessThanOrEqual(2);
  for (const pitch of geometry.pitches) expect(Math.abs(pitch - 0.113)).toBeLessThanOrEqual(0.002);
  expect(Math.max(...geometry.pitchPixels) - Math.min(...geometry.pitchPixels)).toBeLessThanOrEqual(1);

  const { handle, hole } = await firstConnectedEndpoint(page);
  await expectAligned(handle, hole);
  await closeDrawer(page);
  await page.getByRole('button', { name: 'Wire view' }).click();
  await nextPaint(page);
  await expect(page.getByRole('button', { name: 'Wire view' })).toHaveAttribute('aria-pressed', 'true');

  const holeSizes = await page.locator('.panel-hole').evaluateAll((holes) => holes.map((hole) => {
    const box = hole.getBoundingClientRect();
    return Math.min(box.width, box.height);
  }));
  expect(Math.min(...holeSizes)).toBeGreaterThanOrEqual(24);
  await expectAligned(handle, hole);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await nextPaint(page);
  await expectAligned(handle, hole);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await page.setViewportSize({ width: viewport!.width - 17, height: viewport!.height - 13 });
  await nextPaint(page);
  await expectAligned(handle, hole);
  await page.setViewportSize(viewport!);
  await nextPaint(page);
  await expectAligned(handle, hole);

  await page.getByRole('button', { name: 'Fit panel' }).click();
  await nextPaint(page);
  const fitted = await surface.boundingBox();
  expect(fitted).not.toBeNull();
  expect(fitted!.width / fitted!.height).toBeGreaterThanOrEqual(1.78);
  expect(fitted!.width / fitted!.height).toBeLessThanOrEqual(1.82);
  expect(fitted!.width).toBeGreaterThan(fitted!.height);
});

test('fits the logotype inside its plate', async ({ page }) => {
  const plate = await page.locator('.console-plate[data-plate="upper-right"]').boundingBox();
  const logo = await page.locator('[data-legend="right/logotype"]').boundingBox();
  expect(plate).not.toBeNull();
  expect(logo).not.toBeNull();
  expect(logo!.x).toBeGreaterThanOrEqual(plate!.x);
  expect(logo!.x + logo!.width).toBeLessThanOrEqual(plate!.x + plate!.width);
});

test('loads the exact production demo manifest, profile lifecycle, and D2/source facts', async ({ page }) => {
  const selector = page.getByRole('combobox', { name: 'Select demo' });
  expect(await selector.locator('option').evaluateAll((options) => options.map((option) => ({
    id: (option as HTMLOptionElement).value,
    title: option.textContent,
  })))).toEqual(DEMOS.map(({ id, title }) => ({ id, title })));

  const refA = page.locator('.demo-profile-choice[value="MV601-REF-A"]');
  const ideal = page.locator('.demo-profile-choice[value="MV601-IDEAL"]');
  await expect(refA).toBeChecked();
  await expect(ideal).not.toBeChecked();
  await expect(page.locator('.demo-profile-disclosure')).toHaveText(
    'Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.',
  );
  const cordRows = async (): Promise<string[][]> => page.locator('.cord-row').evaluateAll((rows) => (
    rows.map((row) => [...row.querySelectorAll('.cord-end')].map((end) => end.textContent ?? ''))
  ));
  const originalCords = await cordRows();
  expect(originalCords).toHaveLength(44);

  await closeDrawer(page);
  await page.getByRole('button', { name: 'Power', exact: true }).click();
  await expect(page.locator('.trace-text')).toContainText('> power on');
  await page.getByRole('button', { name: 'Library & diagnostics' }).click();
  await ideal.focus();
  await page.keyboard.press('Space');
  await expect(ideal).toBeChecked();
  await expect(ideal).toBeFocused();
  await expect(refA).not.toBeChecked();
  expect(await cordRows()).toEqual(originalCords);
  await expect(page.locator('.trace-text')).toHaveText('');

  await page.getByRole('button', { name: 'Reset selected demo' }).click();
  await expect(ideal).toBeChecked();
  expect(await cordRows()).toEqual(originalCords);
  await expect(page.locator('.trace-text')).toHaveText('');

  await selector.selectOption('ER-ALTCOUNTER');
  await expect(ideal).toBeChecked();
  await expect(page.locator('.cord-row')).toHaveCount(48);
  await expect(page.locator('.trace-text')).toHaveText('');

  await page.reload();
  await expect(page.locator('.console-surface')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'MINIVAC 601 help' })).toBeHidden();
  await expect(refA).toBeChecked();
  await expect(ideal).not.toBeChecked();
  await expect(selector).toHaveValue('IV-EXP1');
  await expect(page.locator('.cord-row')).toHaveCount(44);

  for (const demo of DEMOS) {
    await selector.selectOption(demo.id);
    const entry = page.locator('.demo-entry[data-demo="' + demo.id + '"]');
    await expect(entry).toBeVisible();
    await expect(entry.getByRole('heading', { name: demo.title })).toBeVisible();
    await expect(entry.locator('.demo-source-program')).not.toBeEmpty();
    await expect(entry.locator('.demo-source-locator')).not.toBeEmpty();
    await expect(entry.locator('.demo-source-confidence')).not.toBeEmpty();
    await expect(page.locator('.cord-path')).toHaveCount(demo.cords);
  }

  for (const id of ['IV-EXP1', 'ER-ALTCOUNTER']) {
    await selector.selectOption(id);
    await expect(page.locator('.demo-entry[data-demo="' + id + '"] .demo-notice-paragraph'))
      .toHaveText([...COUNTER_NOTICE]);
  }
});

test('honors reduced motion and supports visible keyboard wiring access', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.console-surface').evaluate((surface) => ({
    transitionDuration: getComputedStyle(surface).transitionDuration,
    animationDuration: getComputedStyle(surface).animationDuration,
  }))).toEqual({ transitionDuration: '0s', animationDuration: '0s' });

  const unnamed = await page.locator('button, input, select').evaluateAll((controls) => controls
    .filter((control) => !control.closest('[hidden]'))
    .filter((control) => {
      const element = control as HTMLElement;
      return !(element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
    })
    .length);
  expect(unnamed).toBe(0);

  await expectFocusVisible(page.getByRole('button', { name: 'Library & diagnostics' }));

  await closeDrawer(page);
  await expectFocusVisible(page.getByRole('button', { name: 'Wire view' }));
  await expectFocusVisible(page.getByRole('button', { name: 'Power', exact: true }));
  await expectFocusVisible(
    page.getByRole('slider', { name: /Relay 1 crossbar/u }),
    page.locator('[data-component="relay-1"]'),
  );
  await expectFocusVisible(
    page.getByRole('slider', { name: /Decimal dial angle/u }),
    page.locator('[data-component="dial-knob"]'),
  );
  const stage = page.locator('.console-stage');
  await stage.focus();
  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Wire view' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: 'Fit panel' })).toHaveAttribute('aria-pressed', 'true');

  for (const hole of [page.locator('.panel-hole:not(.occupied)').first(), page.locator('.panel-hole.occupied').first()]) {
    await expectFocusVisible(hole);
  }

  const endpoint = page.locator('.cord-handle').first();
  await expectFocusVisible(endpoint);
  await page.keyboard.press('Enter');
  await expect(endpoint).toHaveClass(/keyboard-picked/u);
  expect(await endpoint.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  const search = page.getByRole('searchbox', { name: 'Find terminal or hole' });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  expect(await search.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await search.fill('D19');
  const visiblePickerRow = page.locator('.terminal-picker-row:not([hidden])');
  await expect(visiblePickerRow).toHaveCount(1);
  const pickerAction = visiblePickerRow.getByRole('button', { name: 'D19#1', exact: true });
  await expect(pickerAction).toBeVisible();
  await expectFocusVisible(pickerAction);
  await page.keyboard.press('Escape');
  await expect(page.locator('.terminal-picker-host')).toBeHidden();
});
