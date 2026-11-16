/** Notes, gammes et conversions hertz ↔ numéro MIDI (demi-tons, la 440 Hz = 69). */

export type ScaleName = 'major' | 'minor' | 'harmonicMinor' | 'phrygianDominant';

export const SCALE_NAMES: readonly ScaleName[] = ['minor', 'major', 'harmonicMinor', 'phrygianDominant'];

export const NOTE_NAMES = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'] as const;

export const SCALE_LABELS: Readonly<Record<ScaleName, string>> = {
  major: 'majeur',
  minor: 'mineur',
  harmonicMinor: 'mineur harmonique',
  phrygianDominant: 'phrygien dominant (Hijaz)',
};

/** Intervalles en demi-tons depuis la fondamentale. */
const SCALE_INTERVALS: Readonly<Record<ScaleName, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  // 7e degré haussé : la sensible donne la couleur « orientale » du mineur harmonique.
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  // 5e mode du mineur harmonique (Hijaz) : seconde mineure et tierce majeure, fréquent dans le raï.
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
};

const A4_HZ = 440;
const A4_MIDI = 69;
export const SEMITONES_PER_OCTAVE = 12;

export function frequencyToMidi(hz: number): number {
  return A4_MIDI + SEMITONES_PER_OCTAVE * Math.log2(hz / A4_HZ);
}

export function midiToFrequency(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

/** Classe de hauteur (0 = do … 11 = si) d'un numéro MIDI entier. */
export function pitchClass(midi: number): number {
  return ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
}

/** Classes de hauteur d'une gamme dans une tonalité, triées (ex. la mineur → 0, 2, 4, 5, 7, 9, 11). */
export function scalePitchClasses(root: number, scale: ScaleName): number[] {
  return SCALE_INTERVALS[scale].map(interval => pitchClass(root + interval)).sort((a, b) => a - b);
}

export function isInScale(midi: number, root: number, scale: ScaleName): boolean {
  return scalePitchClasses(root, scale).includes(pitchClass(midi));
}

/**
 * Note autorisée (numéro MIDI entier) la plus proche d'une hauteur quelconque.
 * Sans note autorisée, la hauteur est seulement arrondie au demi-ton.
 */
export function nearestAllowedMidi(midi: number, allowedPitchClasses: readonly number[]): number {
  if (allowedPitchClasses.length === 0) {
    return Math.round(midi);
  }
  let best = Math.round(midi);
  let bestDistance = Number.POSITIVE_INFINITY;
  // Une demi-octave de part et d'autre suffit : toute classe de hauteur y apparaît au moins une fois.
  for (let candidate = Math.floor(midi) - 6; candidate <= Math.ceil(midi) + 6; candidate++) {
    const distance = Math.abs(candidate - midi);
    if (allowedPitchClasses.includes(pitchClass(candidate)) && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Note de la gamme (numéro MIDI entier) la plus proche d'une hauteur quelconque. */
export function nearestScaleMidi(midi: number, root: number, scale: ScaleName): number {
  return nearestAllowedMidi(midi, scalePitchClasses(root, scale));
}
