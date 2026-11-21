/**
 * Réglages de mixage par piste du studio : volume (dB), mute et solo.
 * Données sérialisables ; les nœuds audio correspondants vivent dans le transport.
 */

export type TrackId = 'drums' | 'melody' | 'bass' | 'instrumental' | 'voice';

export const TRACK_IDS: readonly TrackId[] = ['drums', 'melody', 'bass', 'instrumental', 'voice'];

/** Bornes du fader de piste, en dB relatifs au niveau d'origine de la piste. */
export const MIN_TRACK_DB = -36;
export const MAX_TRACK_DB = 6;
export const DEFAULT_TRACK_DB = 0;

export interface TrackMix {
  readonly volumeDb: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

export type MixerState = Readonly<Record<TrackId, TrackMix>>;

export function createDefaultMixer(): MixerState {
  const neutral: TrackMix = { volumeDb: DEFAULT_TRACK_DB, muted: false, solo: false };
  return { drums: neutral, melody: neutral, bass: neutral, instrumental: neutral, voice: neutral };
}

export function decibelsToGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

/** Ramène une saisie dans les bornes du fader (valeur non numérique : 0 dB). */
export function clampTrackDb(decibels: number): number {
  if (!Number.isFinite(decibels)) {
    return DEFAULT_TRACK_DB;
  }
  return Math.min(MAX_TRACK_DB, Math.max(MIN_TRACK_DB, decibels));
}

/**
 * Une piste est audible si elle n'est pas muette et, dès qu'une piste est en solo,
 * seulement si elle est elle-même en solo (le mute l'emporte sur le solo).
 */
export function isTrackAudible(mixer: MixerState, track: TrackId): boolean {
  const anySolo = TRACK_IDS.some(id => mixer[id].solo);
  const { muted, solo } = mixer[track];
  return !muted && (!anySolo || solo);
}

/** Gains linéaires effectifs de chaque piste, partagés par l'écoute et l'export. */
export function effectiveTrackGains(mixer: MixerState): Record<TrackId, number> {
  const gains = {} as Record<TrackId, number>;
  for (const id of TRACK_IDS) {
    gains[id] = isTrackAudible(mixer, id) ? decibelsToGain(clampTrackDb(mixer[id].volumeDb)) : 0;
  }
  return gains;
}

/** Renvoie un nouvel état où seule la piste `track` est modifiée. */
export function updateTrack(mixer: MixerState, track: TrackId, change: Partial<TrackMix>): MixerState {
  return { ...mixer, [track]: { ...mixer[track], ...change } };
}
