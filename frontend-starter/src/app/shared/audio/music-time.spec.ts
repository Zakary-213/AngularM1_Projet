import { describe, expect, it } from 'vitest';
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, barsToSeconds, clampBpm, isValidBpm, secondsPerBeat, stepDurationSeconds } from './music-time';

describe('conversions temporelles', () => {
  it('convertit le tempo en durées', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(stepDurationSeconds(120)).toBe(0.125);
    expect(barsToSeconds(4, 120)).toBe(8);
    expect(barsToSeconds(1, 90)).toBeCloseTo(2.6667, 4);
  });

  it('accepte uniquement les BPM dans les bornes', () => {
    expect(isValidBpm(MIN_BPM)).toBe(true);
    expect(isValidBpm(MAX_BPM)).toBe(true);
    expect(isValidBpm(MIN_BPM - 1)).toBe(false);
    expect(isValidBpm(MAX_BPM + 1)).toBe(false);
    expect(isValidBpm(Number.NaN)).toBe(false);
  });

  it('ramène une saisie dans les bornes', () => {
    expect(clampBpm(20)).toBe(MIN_BPM);
    expect(clampBpm(500)).toBe(MAX_BPM);
    expect(clampBpm(92.6)).toBe(93);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BPM);
  });
});
