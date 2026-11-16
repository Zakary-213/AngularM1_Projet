/** Notes, gammes et conversions hertz ↔ numéro MIDI (demi-tons, la 440 Hz = 69). */

export type ScaleName = 'major' | 'minor';

export const NOTE_NAMES = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'] as const;

export const SCALE_LABELS: Readonly<Record<ScaleName, string>> = { major: 'majeur', minor: 'mineur' };

/** Intervalles en demi-tons depuis la fondamentale. */
const SCALE_INTERVALS: Readonly<Record<ScaleName, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const A4_HZ = 440;
const A4_MIDI = 69;
const SEMITONES_PER_OCTAVE = 12;

export function frequencyToMidi(hz: number): number {
  return A4_MIDI + SEMITONES_PER_OCTAVE * Math.log2(hz / A4_HZ);
}

export function midiToFrequency(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

export function isInScale(midi: number, root: number, scale: ScaleName): boolean {
  const degree = (((midi - root) % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
  return SCALE_INTERVALS[scale].includes(degree);
}

/** Note de la gamme (numéro MIDI entier) la plus proche d'une hauteur quelconque. */
export function nearestScaleMidi(midi: number, root: number, scale: ScaleName): number {
  let best = Math.round(midi);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = Math.floor(midi) - 2; candidate <= Math.ceil(midi) + 2; candidate++) {
    const distance = Math.abs(candidate - midi);
    if (isInScale(candidate, root, scale) && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
