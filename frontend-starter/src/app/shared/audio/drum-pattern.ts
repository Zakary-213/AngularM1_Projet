import { STEPS_PER_BAR } from './music-time';

export type DrumVoice = 'kick' | 'snare' | 'hihat';

export const DRUM_VOICES: readonly DrumVoice[] = ['kick', 'snare', 'hihat'];

export const DRUM_VOICE_LABELS: Readonly<Record<DrumVoice, string>> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-hat',
};

/** Pattern d'une mesure : une ligne de 16 pas par instrument. Données sérialisables. */
export type DrumPattern = Readonly<Record<DrumVoice, readonly boolean[]>>;

function rowFrom(activeSteps: readonly number[]): boolean[] {
  return Array.from({ length: STEPS_PER_BAR }, (_, step) => activeSteps.includes(step));
}

/** Rythme boom-bap de départ, pour entendre immédiatement le séquenceur. */
export function createDemoPattern(): DrumPattern {
  return {
    kick: rowFrom([0, 7, 10]),
    snare: rowFrom([4, 12]),
    hihat: rowFrom([0, 2, 4, 6, 8, 10, 12, 14]),
  };
}

/** Renvoie un nouveau pattern (l'original n'est pas modifié). */
export function toggleStep(pattern: DrumPattern, voice: DrumVoice, step: number): DrumPattern {
  if (!Number.isInteger(step) || step < 0 || step >= STEPS_PER_BAR) {
    throw new RangeError(`Pas hors limites : ${step}`);
  }
  const row = pattern[voice].map((active, index) => (index === step ? !active : active));
  return { ...pattern, [voice]: row };
}

export function voicesAtStep(pattern: DrumPattern, step: number): DrumVoice[] {
  const index = step % STEPS_PER_BAR;
  return DRUM_VOICES.filter(voice => pattern[voice][index]);
}
