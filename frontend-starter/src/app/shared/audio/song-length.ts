import { barsToSeconds } from './music-time';

/**
 * Durée du morceau exporté (M10). Unités : mesures pour les clips de pattern,
 * secondes pour les fichiers audio et le résultat.
 */

/** Traîne laissée après la fin du contenu quand une réverbération ou un delay est actif (secondes). */
export const EXPORT_TAIL_SECONDS = 2;
/** Durée maximale d'un export : 10 min (≈ 210 Mo de mémoire pour le rendu stéréo à 44,1 kHz). */
export const MAX_EXPORT_SECONDS = 600;

export interface SongContent {
  readonly bpm: number;
  /** Fin du dernier clip de pattern (batterie, mélodie, basse), en mesures. */
  readonly patternEndBar: number;
  /** Fichiers audio joués : instrumentale et prise active (début négatif possible). */
  readonly audio: readonly { readonly startSeconds: number; readonly durationSeconds: number }[];
  /** Une réverbération ou un delay est envoyé par une piste : on garde leur traîne. */
  readonly effectsActive: boolean;
}

export type ExportLength =
  | { readonly ok: true; readonly seconds: number; readonly contentSeconds: number; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: 'empty' };

/** Fin du dernier son du morceau, en secondes (0 si rien n'est placé). */
export function songEndSeconds(content: Omit<SongContent, 'effectsActive'>): number {
  const patternsEnd = content.patternEndBar > 0 ? barsToSeconds(content.patternEndBar, content.bpm) : 0;
  const audioEnd = content.audio
    .filter(clip => Number.isFinite(clip.startSeconds) && clip.durationSeconds > 0)
    .map(clip => clip.startSeconds + clip.durationSeconds);
  return Math.max(0, patternsEnd, ...audioEnd);
}

/**
 * Durée à rendre : tout le morceau (positions des clips et durée réelle des fichiers),
 * plus la traîne des effets, dans la limite de MAX_EXPORT_SECONDS.
 */
export function exportLength(content: SongContent): ExportLength {
  const contentSeconds = songEndSeconds(content);
  if (contentSeconds <= 0) {
    return { ok: false, reason: 'empty' };
  }
  const wanted = contentSeconds + (content.effectsActive ? EXPORT_TAIL_SECONDS : 0);
  return { ok: true, seconds: Math.min(MAX_EXPORT_SECONDS, wanted), contentSeconds, truncated: contentSeconds > MAX_EXPORT_SECONDS };
}
