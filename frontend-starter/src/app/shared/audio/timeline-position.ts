import { STEPS_PER_BAR, STEPS_PER_BEAT } from './music-time';

/**
 * Positions sur la timeline, en pas absolus (doubles-croches depuis le début du
 * morceau) : conversion d'un clic ou d'une touche, plage de boucle et textes.
 */

/** Longueur maximale d'un morceau dans le studio, en mesures (4/4). */
export const MAX_SONG_BARS = 128;
export const MAX_SONG_STEPS = MAX_SONG_BARS * STEPS_PER_BAR;

export function clampSongStep(step: number, limit = MAX_SONG_STEPS): number {
  return Number.isFinite(step) ? Math.min(limit, Math.max(0, Math.round(step))) : 0;
}

/**
 * Pas correspondant à un clic à la fraction `fraction` (0 à 1) de la fenêtre visible,
 * calé sur le temps le plus proche pour tomber juste en musique.
 */
export function stepFromFraction(fraction: number, visibleBars: number, firstBar = 0, limit = MAX_SONG_STEPS): number {
  const raw = (firstBar + Math.min(1, Math.max(0, fraction)) * visibleBars) * STEPS_PER_BAR;
  return clampSongStep(Math.round(raw / STEPS_PER_BEAT) * STEPS_PER_BEAT, limit);
}

export type PositionKey = 'ArrowLeft' | 'ArrowRight' | 'PageUp' | 'PageDown' | 'Home' | 'End';

/**
 * Nouvelle position après une touche : flèches = un temps, Page = une mesure,
 * Début = début du morceau, Fin = `endStep`. `null` pour une autre touche.
 */
export function stepAfterKey(step: number, key: string, endStep: number, limit = MAX_SONG_STEPS): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampSongStep(step - STEPS_PER_BEAT, limit);
    case 'ArrowRight':
      return clampSongStep(step + STEPS_PER_BEAT, limit);
    case 'PageDown':
      return clampSongStep(step - STEPS_PER_BAR, limit);
    case 'PageUp':
      return clampSongStep(step + STEPS_PER_BAR, limit);
    case 'Home':
      return 0;
    case 'End':
      return clampSongStep(endStep, limit);
    default:
      return null;
  }
}

/** Plage de boucle en mesures (1-indexées, bornes incluses), telle que saisie par l'utilisateur. */
export interface LoopBars {
  readonly fromBar: number;
  readonly toBar: number;
}

export const DEFAULT_LOOP_BARS: LoopBars = { fromBar: 1, toBar: 4 };

/** Renvoie un message d'erreur en français, ou `null` si la plage est valide. */
export function validateLoopBars({ fromBar, toBar }: LoopBars): string | null {
  if (!Number.isInteger(fromBar) || !Number.isInteger(toBar)) {
    return 'Indiquez des numéros de mesure entiers.';
  }
  if (fromBar < 1 || toBar > MAX_SONG_BARS) {
    return `Les mesures vont de 1 à ${MAX_SONG_BARS}.`;
  }
  if (toBar < fromBar) {
    return 'La mesure de fin doit suivre celle du début.';
  }
  return null;
}

export function loopStepRange({ fromBar, toBar }: LoopBars): { startStep: number; endStep: number } {
  return { startStep: (fromBar - 1) * STEPS_PER_BAR, endStep: toBar * STEPS_PER_BAR };
}

/** Position lisible : « mesure 3, temps 2 ». */
export function describePosition(step: number): string {
  const safe = Math.max(0, step);
  const bar = Math.floor(safe / STEPS_PER_BAR) + 1;
  const beat = Math.floor((safe % STEPS_PER_BAR) / STEPS_PER_BEAT) + 1;
  return `mesure ${bar}, temps ${beat}`;
}
