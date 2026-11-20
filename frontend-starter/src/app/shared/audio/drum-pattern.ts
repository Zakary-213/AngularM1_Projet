import { STEPS_PER_BAR } from './music-time';

export type DrumVoice = 'kick' | 'snare' | 'hihat';

export const DRUM_VOICES: readonly DrumVoice[] = ['kick', 'snare', 'hihat'];

export const DRUM_VOICE_LABELS: Readonly<Record<DrumVoice, string>> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-hat',
};

/**
 * Pattern d'une mesure : pour chaque instrument, 16 pas portant la vélocité de la
 * frappe (0 = pas de frappe, 1 = frappe la plus forte). Données sérialisables.
 */
export type DrumPattern = Readonly<Record<DrumVoice, readonly number[]>>;

/** Niveaux proposés au clic, du plus fort au plus doux (gain linéaire de la frappe). */
export const VELOCITY_LEVELS = [1, 0.7, 0.4] as const;
export const VELOCITY_LABELS: Readonly<Record<(typeof VELOCITY_LEVELS)[number], string>> = { 1: 'fort', 0.7: 'moyen', 0.4: 'doux' };

/** Un pattern nommé de la bibliothèque du projet. */
export interface PatternEntry {
  readonly id: string;
  readonly name: string;
  readonly steps: DrumPattern;
}

export const MAX_PATTERNS = 64;
export const PATTERN_NAME_MAX_LENGTH = 40;
export const DEFAULT_PATTERN_ID = 'pattern-1';

function rowFrom(hits: Readonly<Record<number, number>>): number[] {
  return Array.from({ length: STEPS_PER_BAR }, (_, step) => hits[step] ?? 0);
}

function assertStep(step: number): void {
  if (!Number.isInteger(step) || step < 0 || step >= STEPS_PER_BAR) {
    throw new RangeError(`Pas hors limites : ${step}`);
  }
}

function clampVelocity(velocity: number): number {
  return Number.isFinite(velocity) ? Math.min(1, Math.max(0, velocity)) : 0;
}

export function createEmptyPattern(): DrumPattern {
  return { kick: rowFrom({}), snare: rowFrom({}), hihat: rowFrom({}) };
}

/** Rythme boom-bap de départ ; les hi-hats en contretemps sont plus doux pour faire « respirer » le groove. */
export function createDemoPattern(): DrumPattern {
  return {
    kick: rowFrom({ 0: 1, 7: 0.7, 10: 1 }),
    snare: rowFrom({ 4: 1, 12: 1 }),
    hihat: rowFrom({ 0: 1, 2: 0.4, 4: 1, 6: 0.4, 8: 1, 10: 0.4, 12: 1, 14: 0.4 }),
  };
}

/** Libellé du niveau le plus proche (« fort », « moyen », « doux »). */
export function velocityLabel(velocity: number): string {
  const nearest = VELOCITY_LEVELS.reduce((best, level) => (Math.abs(level - velocity) < Math.abs(best - velocity) ? level : best));
  return VELOCITY_LABELS[nearest];
}

export function setStepVelocity(pattern: DrumPattern, voice: DrumVoice, step: number, velocity: number): DrumPattern {
  assertStep(step);
  return { ...pattern, [voice]: pattern[voice].map((value, index) => (index === step ? clampVelocity(velocity) : value)) };
}

/** Active (vélocité forte) ou retire une frappe. */
export function toggleStep(pattern: DrumPattern, voice: DrumVoice, step: number): DrumPattern {
  assertStep(step);
  return setStepVelocity(pattern, voice, step, pattern[voice][step] > 0 ? 0 : VELOCITY_LEVELS[0]);
}

/** Clic sur une case : éteinte → forte → moyenne → douce → éteinte. */
export function cycleStep(pattern: DrumPattern, voice: DrumVoice, step: number): DrumPattern {
  assertStep(step);
  const current = pattern[voice][step];
  if (current <= 0) {
    return setStepVelocity(pattern, voice, step, VELOCITY_LEVELS[0]);
  }
  const index = VELOCITY_LEVELS.findIndex(level => Math.abs(level - current) < 0.05);
  const next = index < 0 || index === VELOCITY_LEVELS.length - 1 ? 0 : VELOCITY_LEVELS[index + 1];
  return setStepVelocity(pattern, voice, step, next);
}

/** Décale toutes les frappes d'une ligne d'un ou plusieurs pas (celles qui sortent reviennent de l'autre côté). */
export function shiftRow(pattern: DrumPattern, voice: DrumVoice, delta: number): DrumPattern {
  const row = pattern[voice];
  const shift = ((Math.round(delta) % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  return { ...pattern, [voice]: row.map((_, index) => row[(index - shift + STEPS_PER_BAR) % STEPS_PER_BAR]) };
}

export interface DrumHit {
  readonly voice: DrumVoice;
  readonly velocity: number;
}

/** Frappes d'un pas (le pas est ramené dans la mesure). */
export function hitsAtStep(pattern: DrumPattern, step: number): DrumHit[] {
  const index = step % STEPS_PER_BAR;
  return DRUM_VOICES.filter(voice => pattern[voice][index] > 0).map(voice => ({ voice, velocity: pattern[voice][index] }));
}

export function voicesAtStep(pattern: DrumPattern, step: number): DrumVoice[] {
  return hitsAtStep(pattern, step).map(hit => hit.voice);
}

export function createPatternId(): string {
  return `pattern-${crypto.randomUUID()}`;
}

/** Nom « Pattern NN » suivant, d'après les noms existants. */
export function nextPatternName(patterns: readonly PatternEntry[]): string {
  const numbers = patterns.map(pattern => /^Pattern (\d+)$/.exec(pattern.name)?.[1]).filter(Boolean).map(Number);
  const next = Math.max(0, ...numbers) + 1;
  return `Pattern ${String(next).padStart(2, '0')}`;
}
