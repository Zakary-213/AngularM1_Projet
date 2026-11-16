import { describe, expect, it } from 'vitest';
import { frequencyToMidi, nearestAllowedMidi, scalePitchClasses } from './musical-scale';
import { correctPitch, targetCorrectionCents } from './pitch-correction';
import { pitchCurvePaths } from './pitch-curve';
import { MAX_USER_STYLES, VOCAL_STYLES, findStyle, parseUserStyles, sameSettings, sanitizeVoiceSettings, styleSettings } from './vocal-styles';
import { FLAT_EQ, eqFilterSpecs, isFlatEq, sanitizeEq } from './voice-eq';
import { detectPitch } from './pitch-detection';

const RATE = 44100;
const A_MINOR = { root: 9, scale: 'minor' as const };

function tone(hz: number, seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE));
}

function measuredHz(samples: Float32Array): number {
  const middle = Math.floor(samples.length / 2);
  return detectPitch(samples.subarray(middle, middle + 2048), RATE)!;
}

describe('gammes ajoutées', () => {
  it('la mineur harmonique hausse le 7e degré (sol♯)', () => {
    expect(scalePitchClasses(9, 'harmonicMinor')).toEqual([0, 2, 4, 5, 8, 9, 11]);
  });

  it('le phrygien dominant (Hijaz) sur ré a mi♭ et fa♯', () => {
    expect(scalePitchClasses(2, 'phrygianDominant')).toEqual([0, 2, 3, 6, 7, 9, 10]);
  });

  it('recale vers la note autorisée la plus proche, même éloignée', () => {
    // Seuls do et sol autorisés : mi (64) est à 3 demi-tons de sol (67) et à 4 de do (60).
    expect(nearestAllowedMidi(64, [0, 7])).toBe(67);
    expect(nearestAllowedMidi(61.4, [0, 7])).toBe(60);
    expect(nearestAllowedMidi(61.4, [])).toBe(61);
  });
});

describe('réglages de justesse', () => {
  it('ne corrige pas un écart sous la tolérance (humanisation)', () => {
    expect(targetCorrectionCents(12, 1, 15)).toBe(0);
    expect(targetCorrectionCents(-30, 0.5, 15)).toBe(-15);
    expect(targetCorrectionCents(30, 1)).toBe(30);
  });

  it('transpose toute la voix d’un nombre de demi-tons', () => {
    const { output } = correctPitch(tone(220, 1), RATE, { ...A_MINOR, strength: 0, retuneMs: 0, transposeSemitones: 2 });
    expect(frequencyToMidi(measuredHz(output)) - frequencyToMidi(220)).toBeCloseTo(2, 1);
  });

  it('respecte les notes autorisées au lieu de la gamme', () => {
    // 230 Hz est près de la (220) ; si la est interdit, la voix part sur si (246,9 Hz).
    const allowed = scalePitchClasses(9, 'minor').filter(pc => pc !== 9);
    const { output } = correctPitch(tone(230, 1), RATE, { ...A_MINOR, strength: 1, retuneMs: 0, allowedPitchClasses: allowed });
    expect(Math.abs(measuredHz(output) - 246.94) / 246.94).toBeLessThan(0.015);
  });
});

describe('styles de correction', () => {
  it('définit six styles aux valeurs bornées', () => {
    expect(VOCAL_STYLES.map(style => style.id)).toEqual(['natural', 'rap', 'trap', 'drill', 'rai', 'robot']);
    for (const style of VOCAL_STYLES) {
      expect(style.strength).toBeGreaterThanOrEqual(0);
      expect(style.strength).toBeLessThanOrEqual(1);
      expect(style.retuneMs).toBeGreaterThanOrEqual(0);
      expect(sanitizeEq(style.eq)).toEqual(style.eq);
    }
  });

  it('Trap et Robot recalent instantanément, Rap reste discret', () => {
    expect(findStyle('trap').retuneMs).toBeLessThanOrEqual(10);
    expect(findStyle('robot').retuneMs).toBe(0);
    expect(findStyle('rap').strength).toBeLessThan(0.5);
  });

  it('le style Raï impose le mineur harmonique dans la tonalité du projet', () => {
    const settings = styleSettings(findStyle('rai'), 1, A_MINOR);
    expect(settings.scale).toBe('harmonicMinor');
    expect(settings.allowedPitchClasses).toEqual(scalePitchClasses(9, 'harmonicMinor'));
  });

  it('un style sans gamme garde celle du projet', () => {
    expect(styleSettings(findStyle('natural'), 1, { root: 0, scale: 'major' }).scale).toBe('major');
  });

  it('la dose baisse l’intensité et ralentit le recalage ensemble', () => {
    const full = styleSettings(findStyle('trap'), 1, A_MINOR);
    const half = styleSettings(findStyle('trap'), 0.5, A_MINOR);
    const none = styleSettings(findStyle('trap'), 0, A_MINOR);
    expect(half.strength).toBeCloseTo(full.strength / 2);
    expect(half.retuneMs).toBeGreaterThan(full.retuneMs);
    expect(none.strength).toBe(0);
  });
});

describe('validation des réglages et styles personnels', () => {
  it('borne et nettoie des réglages venant de l’extérieur', () => {
    const settings = sanitizeVoiceSettings({
      root: 9,
      scale: 'minor',
      allowedPitchClasses: [9, 9, 12, -1, 0],
      strength: 4,
      retuneMs: -5,
      toleranceCents: 999,
      transposeSemitones: 40,
      eq: { lowCutHz: 5000, bodyDb: 'x', presenceDb: -40, airDb: 3 },
    })!;
    expect(settings.allowedPitchClasses).toEqual([0, 9]);
    expect(settings.strength).toBe(1);
    expect(settings.retuneMs).toBe(0);
    expect(settings.toleranceCents).toBe(50);
    expect(settings.transposeSemitones).toBe(12);
    expect(settings.eq).toEqual({ lowCutHz: 300, bodyDb: 0, presenceDb: -12, airDb: 3 });
  });

  it('refuse une gamme ou une tonalité inconnue', () => {
    expect(sanitizeVoiceSettings({ root: 9, scale: 'blues' })).toBeNull();
    expect(sanitizeVoiceSettings({ root: 14, scale: 'minor' })).toBeNull();
    expect(sanitizeVoiceSettings('trap')).toBeNull();
  });

  it('relit les styles personnels en ignorant les entrées invalides', () => {
    const valid = { name: '  Refrain  ', basedOn: 'trap', settings: styleSettings(findStyle('trap'), 1, A_MINOR) };
    const json = JSON.stringify([valid, { name: '', basedOn: 'trap', settings: valid.settings }, { name: 'X', basedOn: 'jazz', settings: valid.settings }, null]);
    const styles = parseUserStyles(json);
    expect(styles).toHaveLength(1);
    expect(styles[0].name).toBe('Refrain');
    expect(sameSettings(styles[0].settings, valid.settings)).toBe(true);
  });

  it('tolère un stockage vide ou corrompu et limite le nombre de styles', () => {
    expect(parseUserStyles(null)).toEqual([]);
    expect(parseUserStyles('{pas du json')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, basedOn: 'rap', settings: styleSettings(findStyle('rap'), 1, A_MINOR) }));
    expect(parseUserStyles(JSON.stringify(many))).toHaveLength(MAX_USER_STYLES);
  });
});

describe('spectre de la voix', () => {
  it('un réglage neutre ne crée aucun filtre', () => {
    expect(isFlatEq(FLAT_EQ)).toBe(true);
    expect(eqFilterSpecs(FLAT_EQ)).toEqual([]);
  });

  it('crée un filtre par bande active, dans l’ordre coupe-bas → air', () => {
    const specs = eqFilterSpecs({ lowCutHz: 100, bodyDb: 0, presenceDb: 3, airDb: 4 });
    expect(specs.map(spec => spec.type)).toEqual(['highpass', 'peaking', 'highshelf']);
    expect(specs[0].frequency).toBe(100);
    expect(specs[1].gain).toBe(3);
  });
});

describe('courbe de hauteur', () => {
  it('trace la hauteur chantée et corrigée, interrompue sur les silences', () => {
    const frames = [
      { detectedHz: 220, correctionCents: 0 },
      { detectedHz: null, correctionCents: 0 },
      { detectedHz: 230, correctionCents: -77 },
    ];
    const paths = pitchCurvePaths(frames, 100, 50)!;
    expect(paths.detected.match(/M/g)).toHaveLength(2);
    expect(paths.minMidi).toBeLessThan(57);
    expect(paths.maxMidi).toBeGreaterThan(58);
  });

  it('ne trace rien sans voix détectée', () => {
    expect(pitchCurvePaths([{ detectedHz: null, correctionCents: 0 }], 100, 50)).toBeNull();
  });
});
