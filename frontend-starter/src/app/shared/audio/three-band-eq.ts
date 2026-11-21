/**
 * Égaliseur 3 bandes d'une piste (graves, médiums, aigus), gains en dB.
 * Les mêmes réglages de filtres servent à l'écoute et à l'export WAV.
 */

export interface ThreeBandEq {
  readonly lowDb: number;
  readonly midDb: number;
  readonly highDb: number;
}

export type EqBand = keyof ThreeBandEq;

export const FLAT_THREE_BAND_EQ: ThreeBandEq = { lowDb: 0, midDb: 0, highDb: 0 };
/** Même borne que le serveur (format de projet v1). */
export const MAX_BAND_DB = 12;

/** Plateau grave sous 200 Hz (kick, 808), cloche à 1 kHz, plateau aigu au-dessus de 4 kHz. */
const LOW_SHELF_HZ = 200;
const MID_PEAK_HZ = 1000;
/** Largeur de la cloche des médiums : un peu plus d'une octave. */
const MID_Q = 0.8;
const HIGH_SHELF_HZ = 4000;
/** Constante de temps des changements pendant la lecture : sans claquement, sans retard audible. */
const EQ_SMOOTHING_SECONDS = 0.02;

export interface EqFilterSpec {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly gain: number;
  readonly Q?: number;
}

function clampBand(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_BAND_DB, Math.max(-MAX_BAND_DB, value)) : 0;
}

export function clampEq(eq: Partial<ThreeBandEq>): ThreeBandEq {
  return { lowDb: clampBand(eq.lowDb ?? 0), midDb: clampBand(eq.midDb ?? 0), highDb: clampBand(eq.highDb ?? 0) };
}

export function isFlatEq(eq: ThreeBandEq): boolean {
  return eq.lowDb === 0 && eq.midDb === 0 && eq.highDb === 0;
}

/** Filtres correspondant aux réglages, dans l'ordre graves → médiums → aigus. */
export function eqFilterSpecs(eq: ThreeBandEq): readonly EqFilterSpec[] {
  const safe = clampEq(eq);
  return [
    { type: 'lowshelf', frequency: LOW_SHELF_HZ, gain: safe.lowDb },
    { type: 'peaking', frequency: MID_PEAK_HZ, gain: safe.midDb, Q: MID_Q },
    { type: 'highshelf', frequency: HIGH_SHELF_HZ, gain: safe.highDb },
  ];
}

export interface EqChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Filtres de la chaîne, pour la déconnecter. */
  readonly nodes: readonly AudioNode[];
  /** Applique de nouveaux gains, lissés si le contexte joue. */
  apply(eq: ThreeBandEq): void;
}

export function createEqChain(context: BaseAudioContext, eq: ThreeBandEq): EqChain {
  const filters = eqFilterSpecs(eq).map(spec => {
    const filter = context.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.frequency;
    filter.gain.value = spec.gain;
    if (spec.Q !== undefined) {
      filter.Q.value = spec.Q;
    }
    return filter;
  });
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  return {
    input: filters[0],
    output: filters[filters.length - 1],
    nodes: filters,
    apply(next: ThreeBandEq) {
      eqFilterSpecs(next).forEach((spec, index) => filters[index].gain.setTargetAtTime(spec.gain, context.currentTime, EQ_SMOOTHING_SECONDS));
    },
  };
}
