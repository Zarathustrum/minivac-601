import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDrawer } from './console-helpers.ts';

const COUNTER_NOTICE = Object.freeze([
  'SDC supplied a second wiring for this counter.',
  "SDC's errata warns that Book IV's three-bit counter can strain the relays, and adds bypass paths so the relay coils receive full voltage and pull in more reliably. Both published wirings are included here.",
  "The simulator's six relay thresholds use an unmeasured fallback. The available evidence does not establish why the physical counter was marginal, and this simulation does not claim to reproduce that cause.",
]);

async function gotoFirstRun(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.console-surface')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'MINIVAC 601 help' })).toBeVisible();
}

async function closeFirstRunHelp(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close help' });
  await expect(close).toBeFocused();
  await close.click();
  await expect(page.getByRole('dialog', { name: 'MINIVAC 601 help' })).toBeHidden();
}

async function expectInViewport(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(await locator.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.right > 0 &&
      bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  })).toBe(true);
}

test('opens first-run Help with complete keyboard-reopenable credits', async ({ page }) => {
  await gotoFirstRun(page);
  const dialog = page.getByRole('dialog', { name: 'MINIVAC 601 help' });
  const close = page.getByRole('button', { name: 'Close help' });
  const help = page.getByRole('button', { name: 'Help & credits' });

  await expect(close).toBeFocused();
  await expect(dialog.locator('.help-step-title')).toHaveText([
    'Load',
    'Power',
    'Operate',
    'Wire',
    'Momentary Touch',
  ]);
  await expect(dialog.locator('.help-limit-redraw')).toContainText(
    'unverified proportions, not physical dimensions',
  );
  await expect(dialog.locator('.help-limit-redraw')).toContainText(
    'Exact RGB values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain unresolved',
  );
  await expect(dialog.locator('.help-limit-power')).toContainText(
    'binary interface projection: lit when rail voltage is above zero and dark at zero',
  );
  await expect(dialog.locator('.help-limit-redraw')).toContainText(
    'no dimension of the original is known',
  );
  await expect(dialog.locator('.help-limit-power')).toContainText(
    'every sound other than the relay click are simulated presentation',
  );

  const expectedCredits = [
    {
      heading: 'Primary panel photograph (PH2)',
      creator: 'Autopilot',
      source: 'https://commons.wikimedia.org/wiki/File:Minivac_601.jpg',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      disclosure: 'It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0.',
    },
    {
      heading: 'POWER-jewel evidence (PH3)',
      creator: 'Mike Rosenberg',
      source: 'https://commons.wikimedia.org/wiki/File:Minivac_601_DSCF1392.jpg',
      license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      disclosure: 'Corroboration for the factory POWER jewel and unit-to-unit variation only;',
    },
    {
      heading: 'Relay simulation cue',
      creator: 'bassmosphere',
      source: 'https://freesound.org/people/bassmosphere/sounds/384698/',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      disclosure: 'The shipped attenuated derivative is a simulated operation cue, not an authenticated MINIVAC recording.',
    },
    {
      heading: 'Rotary drive-wheel simulation loop',
      creator: 'jwiese',
      source: 'https://opengameart.org/content/enginemechanic-working-sound',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      disclosure: 'The shipped attenuated, wrap-crossfaded derivative is a simulated motor cue, not an authenticated MINIVAC recording.',
    },
    {
      heading: 'Relay release simulation',
      creator: 'bassmosphere',
      source: 'https://freesound.org/people/bassmosphere/sounds/384698/',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      disclosure: 'Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording.',
    },
  ] as const;

  const credits = dialog.locator('.help-credit');
  await expect(credits).toHaveCount(expectedCredits.length);
  for (const [index, expected] of expectedCredits.entries()) {
    const credit = credits.nth(index);
    await expect(credit.locator('.help-credit-title')).toContainText(
      expected.heading + ' — ' + expected.creator + '.',
    );
    await expect(credit.getByRole('link', { name: expected.heading + ' source' }))
      .toHaveAttribute('href', expected.source);
    await expect(credit.getByRole('link', { name: expected.license }))
      .toHaveAttribute('href', expected.licenseUrl);
    await expect(credit.locator('.help-credit-description')).toContainText(expected.disclosure);
  }

  const lastLink = dialog.getByRole('link', { name: 'CC0 1.0' }).last();
  await lastLink.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastLink).toBeFocused();

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
});

test('keeps source, confidence, and exact D2 copy reachable through the keyboard', async ({ page }) => {
  await gotoFirstRun(page);
  await closeFirstRunHelp(page);

  const selector = page.getByRole('combobox', { name: 'Select demo' });
  await selector.focus();
  await expect(selector).toBeFocused();
  await page.keyboard.press('s');
  await expect(selector).toHaveValue('ER-ALTCOUNTER');
  const alternate = page.locator('.demo-entry[data-demo="ER-ALTCOUNTER"]');
  await expect(alternate).toBeVisible();
  await expect(alternate.locator('.demo-source-program')).toHaveText('ER-ALTCOUNTER');
  await expect(alternate.locator('.demo-notice-paragraph')).toHaveText([...COUNTER_NOTICE]);
  await expect(page.locator('.cord-path')).toHaveCount(48);
  await selector.selectOption('IV-EXP1');
  await expect(selector).toHaveValue('IV-EXP1');

  const entry = page.locator('.demo-entry[data-demo="IV-EXP1"]');
  const source = entry.getByRole('region', { name: 'Source' });
  await expect(source.locator('.demo-source-program')).toHaveText('IV-EXP1');
  await expect(source.locator('.demo-source-locator'))
    .toHaveText('Book IV printed pp.71-72 = book2-3-4.pdf PDF pp.77-78');
  await expect(source.locator('.demo-source-confidence')).toHaveText('verified');

  await expectInViewport(source.locator('.demo-source-confidence'));
  const notice = entry.locator('.demo-notice-paragraph');
  await expect(notice).toHaveText([...COUNTER_NOTICE]);
  for (const paragraph of await notice.all()) await expectInViewport(paragraph);
});

test('keeps single-paragraph and multi-line notices whole and reachable', async ({ page }) => {
  await gotoFirstRun(page);
  await closeFirstRunHelp(page);
  const selector = page.getByRole('combobox', { name: 'Select demo' });

  await selector.selectOption('VI-COMBOLOCK');
  const lock = page.locator('.demo-entry[data-demo="VI-COMBOLOCK"] .demo-notice-paragraph');
  await expect(lock).toHaveText(['To re-set the game, turn the rotary switch through one complete revolution.']);
  await expectInViewport(lock);

  await selector.selectOption('V-EXP19');
  const morse = page.locator('.demo-entry[data-demo="V-EXP19"] .demo-notice-paragraph');
  await expect(morse).toHaveCount(1);
  await expectInViewport(morse);
  const lines = (await morse.innerText()).split('\n');
  expect(lines).toHaveLength(6);
  expect(lines[0]).toBe('Dial plate (Book V printed p.33): each letter and the rotary switch numbers it covers.');
  expect(lines[5]).toBe('Always turn the rotary switch (pointer knob) clockwise.');
  expect(await morse.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows and persists mute without replaying queued cues after reload', async ({ page }) => {
  await page.addInitScript(() => {
    const probeKey = 'minivac.browser-audio-probe';
    type Probe = { contexts: number; starts: number; stops: number };
    const read = (): Probe => JSON.parse(
      sessionStorage.getItem(probeKey) ?? '{"contexts":0,"starts":0,"stops":0}',
    ) as Probe;
    const update = (field: keyof Probe): void => {
      const probe = read();
      probe[field]++;
      sessionStorage.setItem(probeKey, JSON.stringify(probe));
    };

    class FakeAudioParam {
      setValueAtTime(): void {}
    }

    class FakeAudioSource extends EventTarget {
      buffer: unknown = null;
      loop = false;
      readonly playbackRate = new FakeAudioParam();

      connect(): void {}

      start(): void {
        update('starts');
      }

      stop(): void {
        update('stops');
      }
    }

    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      readonly destination = {};

      constructor() {
        update('contexts');
      }

      resume(): Promise<void> {
        this.state = 'running';
        return Promise.resolve();
      }

      decodeAudioData(): Promise<unknown> {
        return Promise.resolve({});
      }

      createBufferSource(): FakeAudioSource {
        return new FakeAudioSource();
      }

      close(): Promise<void> {
        this.state = 'closed';
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, '__minivacAudioProbe', {
      configurable: true,
      value: { read },
    });
  });

  await gotoFirstRun(page);
  await closeFirstRunHelp(page);
  const enable = page.getByRole('button', { name: 'Enable sound' });
  await enable.click();
  const soundOn = page.getByRole('button', { name: 'Sound on' });
  await expect(soundOn).toBeVisible();
  const readProbe = async (): Promise<{ contexts: number; starts: number; stops: number }> => page.evaluate(() => (
    window as unknown as { __minivacAudioProbe: { read(): { contexts: number; starts: number; stops: number } } }
  ).__minivacAudioProbe.read());
  const beforeCue = await readProbe();

  await page.getByRole('combobox', { name: 'Select demo' }).selectOption('III-RELAYNOT');
  await closeDrawer(page);
  await page.getByRole('button', { name: 'Power', exact: true }).click();
  const pushbutton = page.getByRole('button', { name: /Pushbutton 1/u });
  await pushbutton.focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('.trace-text')).toContainText('relay1 mid->no');
  await page.keyboard.up('Enter');
  await expect(page.locator('.trace-text')).toContainText('relay1 mid->nc');
  await expect.poll(async () => (await readProbe()).starts).toBeGreaterThan(beforeCue.starts + 1);

  const beforeReplacement = await readProbe();
  await page.getByRole('button', { name: 'Library & diagnostics' }).click();
  await page.locator('.demo-profile-choice[value="MV601-IDEAL"]').click();
  await expect(page.locator('.trace-text')).toHaveText('');
  await expect.poll(async () => (await readProbe()).stops).toBeGreaterThan(beforeReplacement.stops);
  expect((await readProbe()).starts).toBe(beforeReplacement.starts);

  await soundOn.click();

  const muted = page.getByRole('button', { name: 'Sound muted' });
  await expect(muted).toBeVisible();
  await expect(muted).toHaveAttribute('aria-pressed', 'false');
  const beforeMutedCue = await readProbe();
  await page.getByRole('button', { name: 'Reset selected demo' }).click();
  await closeDrawer(page);
  await page.getByRole('button', { name: 'Power', exact: true }).click();
  await pushbutton.focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('.trace-text')).toContainText('relay1 mid->no');
  await page.keyboard.up('Enter');
  await page.waitForTimeout(100);
  expect((await readProbe()).starts).toBe(beforeMutedCue.starts);
  const beforeReload = await readProbe();

  await page.reload();
  await expect(page.locator('.console-surface')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound muted' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'MINIVAC 601 help' })).toBeHidden();
  await page.waitForTimeout(150);
  expect(await readProbe()).toEqual(beforeReload);
});
