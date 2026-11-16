import { describe, expect, it } from 'vitest';
import { frequencyToMidi, isInScale, midiToFrequency, nearestScaleMidi } from './musical-scale';
import { detectPitch } from './pitch-detection';
import { MAX_CORRECTION_SECONDS, PITCH_PRESETS, correctPitch, meanScaleDeviation, scaleDeviationCents } from './pitch-correction';
import { createTestVoice } from './test-voice';

const RATE = 44100;
const A_MINOR = { root: 9, scale: 'minor' as const };

function tone(hz: number, seconds: number, sampleRate = RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate));
}

/** Hauteur médiane mesurée au milieu d'un signal, en évitant les bords. */
function measuredHz(samples: Float32Array): number {
  const frame = samples.subarray(Math.floor(samples.length / 2), Math.floor(samples.length / 2) + 2048);
  return detectPitch(frame, RATE)!;
}

describe('gammes', () => {
  it('convertit les hertz et les numéros MIDI', () => {
    expect(frequencyToMidi(440)).toBe(69);
    expect(midiToFrequency(57)).toBeCloseTo(220, 6);
  });

  it('reconnaît les notes de la mineur', () => {
    expect([57, 59, 60, 62, 64, 65, 67].every(midi => isInScale(midi, 9, 'minor'))).toBe(true);
    expect(isInScale(58, 9, 'minor')).toBe(false);
    expect(isInScale(61, 0, 'major')).toBe(false);
  });

  it('choisit la note de la gamme la plus proche', () => {
    expect(nearestScaleMidi(57.3, 9, 'minor')).toBe(57);
    // la♯ (58) n'est pas dans la mineur : 58,2 va vers si (59), plus proche que la (57).
    expect(nearestScaleMidi(58.2, 9, 'minor')).toBe(59);
    expect(scaleDeviationCents(midiToFrequency(57.25), 9, 'minor')).toBeCloseTo(-25, 6);
  });
});

describe('détection de hauteur (YIN)', () => {
  it.each([110, 220, 440, 880])('mesure %d Hz à moins de 0,5 %% près', hz => {
    expect(Math.abs(detectPitch(tone(hz, 0.05), RATE)! - hz) / hz).toBeLessThan(0.005);
  });

  it('renvoie null pour du bruit ou du silence', () => {
    let seed = 1;
    const noise = Float32Array.from({ length: 2048 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
    expect(detectPitch(noise, RATE)).toBeNull();
    expect(detectPitch(new Float32Array(2048), RATE)).toBeNull();
  });
});

describe('correction de hauteur', () => {
  it('ramène 230 Hz sur la (220 Hz) en mode effet marqué, sans changer la durée', () => {
    const input = tone(230, 1);
    const { output } = correctPitch(input, RATE, { ...A_MINOR, ...PITCH_PRESETS.hard });
    expect(output.length).toBe(input.length);
    expect(Math.abs(measuredHz(output) - 220) / 220).toBeLessThan(0.01);
  });

  it('corrige vers le haut aussi (243 Hz → si, 246,9 Hz)', () => {
    const { output } = correctPitch(tone(243, 1), RATE, { ...A_MINOR, ...PITCH_PRESETS.hard });
    expect(Math.abs(measuredHz(output) - 246.94) / 246.94).toBeLessThan(0.01);
  });

  it('une intensité de 60 % corrige environ 60 % de l’écart', () => {
    const { output } = correctPitch(tone(230, 1), RATE, { ...A_MINOR, strength: 0.6, retuneMs: 0 });
    const remainingCents = (frequencyToMidi(measuredHz(output)) - 57) * 100;
    const initialCents = (frequencyToMidi(230) - 57) * 100;
    expect(remainingCents / initialCents).toBeGreaterThan(0.3);
    expect(remainingCents / initialCents).toBeLessThan(0.5);
  });

  it('laisse le signal intact avec une intensité nulle', () => {
    const input = tone(230, 0.5);
    const { output } = correctPitch(input, RATE, { ...A_MINOR, strength: 0, retuneMs: 0 });
    const middle = Math.floor(input.length / 2);
    for (let i = middle; i < middle + 100; i++) {
      expect(output[i]).toBeCloseTo(input[i], 3);
    }
  });

  it('réduit nettement l’écart moyen à la gamme sur la voix de test', () => {
    const voice = createTestVoice(RATE);
    const { output, frames } = correctPitch(voice, RATE, { ...A_MINOR, ...PITCH_PRESETS.hard });
    const before = meanScaleDeviation(frames, 9, 'minor')!;
    const after = meanScaleDeviation(correctPitch(output, RATE, { ...A_MINOR, strength: 0, retuneMs: 0 }).frames, 9, 'minor')!;
    expect(before).toBeGreaterThan(20);
    expect(after).toBeLessThan(before / 2);
  });

  it('refuse un extrait trop long', () => {
    expect(() => correctPitch(new Float32Array((MAX_CORRECTION_SECONDS + 1) * 8000), 8000, { ...A_MINOR, ...PITCH_PRESETS.hard })).toThrow(RangeError);
  });
});
