/**
 * Every printed motor claim in `tools/motor-claims.ts` holds at the shipped MV601-REF-A profile.
 *
 * The full sensitivity sweep (`npm run motor-sweep`, about 6 minutes) is too slow for the normal suite;
 * this runs only the shipped profile, so a core change that breaks a printed motor answer fails here.
 */
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import { loadProfile } from '../src/core/profile.ts';
import { MOTOR_CLAIMS } from '../tools/motor-claims.ts';

const profile = loadProfile(refJson);

describe('printed motor claims at the shipped profile', () => {
  for (const claim of MOTOR_CLAIMS) {
    it(claim.id + ' (' + claim.cite + ')', () => {
      const result = claim.check(profile);
      expect(result.pass, result.detail).toBe(true);
    }, 30_000);
  }
});
