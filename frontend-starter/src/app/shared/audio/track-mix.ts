import { FLAT_THREE_BAND_EQ, ThreeBandEq, clampEq } from './three-band-eq';

/**
 * Réglages de mixage du studio (M7) : par piste, volume (dB), mute, solo,
 * panoramique, égaliseur 3 bandes et envois vers la réverbération et le delay
 * partagés ; volume Master. Données sérialisables : les nœuds audio
 * correspondants sont construits par `mixer-graph.ts`, à l'écoute comme à l'export.
 */

export type TrackId = 'drums' | 'melody' | 'bass' | 'instrumental' | 'voice';

export const TRACK_IDS: readonly TrackId[] = ['drums', 'melody', 'bass', 'instrumental', 'voice'];

/** Bornes du fader de piste, en dB relatifs au niveau d'origine de la piste. */
export const MIN_TRACK_DB = -36;
export const MAX_TRACK_DB = 6;
export const DEFAULT_TRACK_DB = 0;

/** Panoramique : -1 = tout à gauche, 0 = centre, 1 = tout à droite (même borne que le serveur). */
export const MIN_PAN = -1;
export const MAX_PAN = 1;

/** Niveau d'envoi proposé à l'activation d'un effet (0 à 1). */
export const DEFAULT_SEND_AMOUNT = 0.3;

/**
 * Volume Master, stocké en gain linéaire (0 à 1, format v1). 0,8 laisse une marge
 * sous 0 dBFS pour que les pistes additionnées saturent moins. Le fader l'affiche en dB.
 */
export const DEFAULT_MASTER_VOLUME = 0.8;
export const MIN_MASTER_DB = -36;
export const MAX_MASTER_DB = 0;

/** Envoi d'une piste vers un effet partagé : activé ou non, et quantité (0 à 1). */
export interface FxSend {
  readonly enabled: boolean;
  readonly amount: number;
}

export const OFF_SEND: FxSend = { enabled: false, amount: DEFAULT_SEND_AMOUNT };

export interface TrackMix {
  readonly volumeDb: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly pan: number;
  readonly eq: ThreeBandEq;
  readonly reverb: FxSend;
  readonly delay: FxSend;
}

export type MixerState = Readonly<Record<TrackId, TrackMix>>;

export const NEUTRAL_TRACK_MIX: TrackMix = {
  volumeDb: DEFAULT_TRACK_DB,
  muted: false,
  solo: false,
  pan: 0,
  eq: FLAT_THREE_BAND_EQ,
  reverb: OFF_SEND,
  delay: OFF_SEND,
};

export function createDefaultMixer(): MixerState {
  const neutral = NEUTRAL_TRACK_MIX;
  return { drums: neutral, melody: neutral, bass: neutral, instrumental: neutral, voice: neutral };
}

export function decibelsToGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Ramène une saisie dans les bornes du fader (valeur non numérique : 0 dB). */
export function clampTrackDb(decibels: number): number {
  return clamp(decibels, MIN_TRACK_DB, MAX_TRACK_DB, DEFAULT_TRACK_DB);
}

/** Panoramique borné ; valeur non numérique : centre. */
export function clampPan(pan: number): number {
  return clamp(pan, MIN_PAN, MAX_PAN, 0);
}

export function clampSend(send: Partial<FxSend>): FxSend {
  return { enabled: send.enabled === true, amount: clamp(Number(send.amount), 0, 1, DEFAULT_SEND_AMOUNT) };
}

/** Volume Master linéaire borné à 0..1 ; valeur non numérique : volume par défaut. */
export function clampMasterVolume(volume: number): number {
  return clamp(volume, 0, 1, DEFAULT_MASTER_VOLUME);
}

/** Position du fader Master (dB) pour un volume linéaire ; le silence s'affiche au minimum. */
export function masterVolumeToDb(volume: number): number {
  const safe = clampMasterVolume(volume);
  return safe > 0 ? Math.max(MIN_MASTER_DB, 20 * Math.log10(safe)) : MIN_MASTER_DB;
}

/** Volume linéaire pour une position du fader Master (dB), arrondi pour la sauvegarde. */
export function masterDbToVolume(decibels: number): number {
  const safe = clamp(decibels, MIN_MASTER_DB, MAX_MASTER_DB, masterVolumeToDb(DEFAULT_MASTER_VOLUME));
  return Math.round(decibelsToGain(safe) * 10000) / 10000;
}

/**
 * Réglages d'une piste lus depuis une source non fiable (projet chargé, saisie) :
 * chaque champ absent ou invalide reprend sa valeur neutre.
 */
export function sanitizeTrackMix(mix: Partial<TrackMix>): TrackMix {
  return {
    volumeDb: clampTrackDb(Number(mix.volumeDb ?? DEFAULT_TRACK_DB)),
    muted: mix.muted === true,
    solo: mix.solo === true,
    pan: clampPan(Number(mix.pan ?? 0)),
    eq: clampEq(mix.eq ?? FLAT_THREE_BAND_EQ),
    reverb: clampSend(mix.reverb ?? OFF_SEND),
    delay: clampSend(mix.delay ?? OFF_SEND),
  };
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

/**
 * Gain d'un envoi d'effet (0 s'il est désactivé). L'envoi est pris après le fader :
 * une piste muette ou coupée par un solo n'alimente plus la réverbération ni le delay.
 */
export function sendGain(send: FxSend): number {
  return send.enabled ? clamp(send.amount, 0, 1, 0) : 0;
}

/** Renvoie un nouvel état où seule la piste `track` est modifiée (valeurs bornées). */
export function updateTrack(mixer: MixerState, track: TrackId, change: Partial<TrackMix>): MixerState {
  return { ...mixer, [track]: sanitizeTrackMix({ ...mixer[track], ...change }) };
}
