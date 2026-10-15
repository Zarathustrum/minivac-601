import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import assets from '../data/public-assets.json';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const EXPECTED = {
  schema: 'minivac.public-assets/1',
  records: [
    {
      id: 'panel-ph2-primary', kind: 'source-image',
      localPath: 'docs/research/raw/photos/commons-minivac601-main.jpg',
      sourcePage: 'https://commons.wikimedia.org/wiki/File:Minivac_601.jpg',
      directSource: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Minivac_601.jpg',
      creator: 'Autopilot', captureDate: '2015-05-12', license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      sha256: '8978c2e88b290ccd3f755f0d53e77cdc8564751ab3ae4f3cd931162d87ea32f9',
      purpose: 'primary panel geometry and visual facts',
      derivativeStatus: 'The procedural panel redraw is treated as an adaptation; its panel-art contribution is CC BY-SA 4.0. The source raster is not shipped. Geometry and colour tokens are photograph-measured, unverified proportions rather than physical dimensions.',
      ship: false,
    },
    {
      id: 'panel-ph3-corroboration', kind: 'source-image',
      localPath: 'docs/research/raw/photos/commons-minivac601-DSCF1392.jpg',
      sourcePage: 'https://commons.wikimedia.org/wiki/File:Minivac_601_DSCF1392.jpg',
      directSource: 'https://upload.wikimedia.org/wikipedia/commons/6/61/Minivac_601_DSCF1392.jpg',
      creator: 'Mike Rosenberg', captureDate: '2012-04-10', license: 'CC-BY-2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      sha256: '8bbf106a08ccb1e9634f0d069dfa8a460dfe56596e1565f9a1498433e04856ef',
      purpose: 'corroboration only; oblique geometry is not measured',
      derivativeStatus: 'Used to establish the factory POWER jewel and unit-to-unit variation; the source raster is not shipped.',
      ship: false,
    },
    {
      id: 'relay-simulation-source', kind: 'source-audio',
      localPath: 'docs/research/raw/audio/relay-switch-bassmosphere-preview.mp3',
      sourcePage: 'https://freesound.org/people/bassmosphere/sounds/384698/',
      directSource: 'https://cdn.freesound.org/previews/384/384698_1067129-hq.mp3',
      creator: 'bassmosphere', captureDate: '2017-03-19', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: 'b9149d8ca70d77b4a1ee23fb04adb685563491a83a34127ee0b5e5be91f2b931',
      purpose: 'source for the simulated relay operation cue',
      derivativeStatus: 'Freesound HQ MP3 preview of a 1970s pinball relay. It is the pinned source for the attenuated relay-cue derivative below and is not an authenticated MINIVAC recording.',
      ship: false,
    },
    {
      id: 'rotary-drive-simulation-source', kind: 'source-audio',
      localPath: 'docs/research/raw/audio/rotary-drive-jwiese-loop.flac',
      sourcePage: 'https://opengameart.org/content/enginemechanic-working-sound',
      directSource: 'https://opengameart.org/sites/default/files/loop.flac',
      creator: 'jwiese', captureDate: '2017-05-21', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: '9b27e733e7fb201450c49c7c9ad5b3b6751138f69b7a1a494cd14f3ef6f85019',
      purpose: 'source for the simulated rotary motor and drive-wheel loop',
      derivativeStatus: 'Published engine/mechanic loop. It is the pinned source for the attenuated wrap-crossfaded rotary-drive-loop derivative below and is not an authenticated MINIVAC recording.',
      ship: false,
    },
    {
      id: 'relay-cue', kind: 'shipped-audio',
      localPath: 'public/audio/relay-cue.wav',
      sourcePage: 'https://freesound.org/people/bassmosphere/sounds/384698/',
      directSource: 'https://cdn.freesound.org/previews/384/384698_1067129-hq.mp3',
      creator: 'bassmosphere', captureDate: '2017-03-19', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: 'ed35a3c8c59b0ec3ecc8688a040851cce25df9688475152d31d9c8a1aeb1517f',
      purpose: 'shipped simulated relay operation cue',
      derivativeStatus: 'Derived from the pinned bassmosphere source with ffmpeg 8.1.2: mono 22050 Hz signed 16-bit PCM, fixed-precision gain 0.22. This simulated cue is not an authenticated MINIVAC recording.',
      ship: true,
    },
    {
      id: 'rotary-drive-loop', kind: 'shipped-audio',
      localPath: 'public/audio/rotary-drive-loop.wav',
      sourcePage: 'https://opengameart.org/content/enginemechanic-working-sound',
      directSource: 'https://opengameart.org/sites/default/files/loop.flac',
      creator: 'jwiese', captureDate: '2017-05-21', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: '9d8b906cd8aac68092a4469d81fb83344b48d45bf6334023366f552dfdb67a59',
      purpose: 'shipped simulated rotary motor and drive-wheel loop',
      derivativeStatus: 'Derived from the pinned jwiese source with ffmpeg 8.1.2: mono 22050 Hz signed 16-bit PCM, fixed-precision gain 0.18. The final 1103-sample nearest-50-ms segment crossfades into the first, and the output begins and wraps at the corresponding boundary. This simulated loop is not an authenticated MINIVAC recording.',
      ship: true,
    },
    {
      id: 'relay-drop-out-cue', kind: 'shipped-audio',
      localPath: 'public/audio/relay-drop-out-cue.wav',
      sourcePage: 'https://freesound.org/people/bassmosphere/sounds/384698/',
      directSource: 'https://cdn.freesound.org/previews/384/384698_1067129-hq.mp3',
      creator: 'bassmosphere', captureDate: '2017-03-19', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: '46e10dd9ff816104a63c8f9e4f100a15e7cb264893095cfbc9dc127cc75398c7',
      purpose: 'shipped simulated relay drop-out cue',
      derivativeStatus: 'Derived from the pinned bassmosphere source with ffmpeg 8.1.2: the full decoded transient is reversed with areverse, then attenuated with volume=0.14:precision=fixed and emitted as mono 22050 Hz signed 16-bit PCM; -map_metadata -1 removes source metadata and -fflags +bitexact -flags:a +bitexact make muxer and codec output reproducible. This simulated release cue is not an authenticated MINIVAC recording',
      ship: true,
    },
  ],
  excludedReferences: [
    {
      id: 'panel-ph1-low-resolution',
      localPath: 'docs/research/raw/prebrief/images/image_3.jpg',
      sha256: '62de0ec0083d2079c0aab1f17225b3a4cd7cb19b50470e3f8ba4629eddfb1f68',
      rule: 'Do not use for fine silkscreen, colour, or geometry measurement; do not ship.',
    },
    {
      id: 'panel-ph4-minivac-6010',
      localPath: 'docs/research/raw/photos/commons-minivac6010-mit-museum.jpg',
      sourcePage: 'https://commons.wikimedia.org/wiki/File:Minivac_6010_Computer,_Scientific_Development_Corporation,_1962_-_MIT_Museum_-_Cambridge,_MA_-_DSC09163.jpg',
      creator: 'Daderot', captureDate: '2026-04-17', license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sha256: 'af4c2104e2128785c5a9f791881f61b971cb0356602176c9200695d8d4db1c32',
      rule: 'MINIVAC 6010 only; forbidden for MINIVAC 601 geometry; do not ship.',
    },
  ],
} as const;

describe('Phase 2 public asset provenance', () => {
  it('pins every field independently and owns an exact unique manifest', () => {
    expect(assets).toEqual(EXPECTED);
    const ids = [...assets.records, ...assets.excludedReferences].map((row) => row.id);
    expect(ids).toEqual([
      'panel-ph2-primary', 'panel-ph3-corroboration', 'relay-simulation-source',
      'rotary-drive-simulation-source', 'relay-cue', 'rotary-drive-loop',
      'relay-drop-out-cue',
      'panel-ph1-low-resolution', 'panel-ph4-minivac-6010',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recomputes every independently pinned local SHA-256', () => {
    for (const row of [...EXPECTED.records, ...EXPECTED.excludedReferences]) {
      // The public copy omits the prebrief images; an excluded reference may be recorded but absent.
      if (row.id === 'panel-ph1-low-resolution' && !existsSync(ROOT + '/' + row.localPath)) continue;
      const bytes = readFileSync(ROOT + '/' + row.localPath);
      expect(createHash('sha256').update(bytes).digest('hex'), row.id).toBe(row.sha256);
    }
  });

  it('pins the shipped WAV format, frame counts and seamless rotary boundary', () => {
    const expected = [
      { path: 'public/audio/relay-cue.wav', frames: 4168, bytes: 8380 },
      { path: 'public/audio/rotary-drive-loop.wav', frames: 39072, bytes: 78188 },
      { path: 'public/audio/relay-drop-out-cue.wav', frames: 4168, bytes: 8380 },
    ] as const;
    for (const row of expected) {
      const bytes = readFileSync(ROOT + '/' + row.path);
      expect(bytes.toString('ascii', 0, 4), row.path).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12), row.path).toBe('WAVE');
      expect(bytes.toString('ascii', 12, 16), row.path).toBe('fmt ');
      expect(bytes.readUInt32LE(16), row.path).toBe(16);
      expect(bytes.readUInt16LE(20), row.path).toBe(1);
      expect(bytes.readUInt16LE(22), row.path).toBe(1);
      expect(bytes.readUInt32LE(24), row.path).toBe(22_050);
      expect(bytes.readUInt32LE(28), row.path).toBe(44_100);
      expect(bytes.readUInt16LE(32), row.path).toBe(2);
      expect(bytes.readUInt16LE(34), row.path).toBe(16);
      expect(bytes.toString('ascii', 36, 40), row.path).toBe('data');
      expect(bytes.readUInt32LE(40) / 2, row.path).toBe(row.frames);
      expect(bytes.length, row.path).toBe(row.bytes);
    }

    const rotary = readFileSync(ROOT + '/public/audio/rotary-drive-loop.wav');
    const first = rotary.readInt16LE(44);
    const last = rotary.readInt16LE(rotary.length - 2);
    expect([first, last, Math.abs(last - first)]).toEqual([624, 648, 24]);
  });

  it('ships only the derived cues and keeps their source, creator and license links explicit', () => {
    const audio = EXPECTED.records.filter((row) => row.kind.endsWith('audio'));
    expect(audio.filter((row) => row.ship).map((row) => row.id))
      .toEqual(['relay-cue', 'rotary-drive-loop', 'relay-drop-out-cue']);
    for (const row of audio.filter((entry) => entry.ship)) {
      expect(row.sourcePage).toMatch(/^https:\/\//u);
      expect(row.directSource).toMatch(/^https:\/\//u);
      expect(row.creator.length).toBeGreaterThan(0);
      expect(row.licenseUrl).toMatch(/^https:\/\//u);
      expect(row.derivativeStatus).toContain('not an authenticated MINIVAC recording');
    }
  });
});
