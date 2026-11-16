/**
 * Conversions temporelles du studio. Unités : secondes (horloge AudioContext),
 * temps (beats), pas de séquenceur (doubles-croches) et mesures en 4/4.
 */

/** Bornes de tempo acceptées par le studio, en BPM. */
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 90;

/** Mesure 4/4 découpée en doubles-croches : 16 pas par mesure. */
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

const SECONDS_PER_MINUTE = 60;

export function isValidBpm(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM;
}

/** Ramène une saisie quelconque dans les bornes, arrondie au BPM entier. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return DEFAULT_BPM;
  }
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function secondsPerBeat(bpm: number): number {
  return SECONDS_PER_MINUTE / bpm;
}

export function stepDurationSeconds(bpm: number): number {
  return secondsPerBeat(bpm) / STEPS_PER_BEAT;
}

export function barsToSeconds(bars: number, bpm: number): number {
  return bars * BEATS_PER_BAR * secondsPerBeat(bpm);
}

