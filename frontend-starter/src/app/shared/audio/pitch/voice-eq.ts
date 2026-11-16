/**
 * « Spectre de la voix » : égaliseur simple à quatre réglages appliqué à la
 * version corrigée. Gains en dB, fréquences en hertz.
 */

export interface VoiceEq {
  /** Coupe-bas (passe-haut) en Hz ; 0 = désactivé. Retire grondements et bruits de manipulation. */
  readonly lowCutHz: number;
  /** Corps de la voix (cloche vers 250 Hz). */
  readonly bodyDb: number;
  /** Présence / intelligibilité (cloche vers 3,5 kHz). */
  readonly presenceDb: number;
  /** « Air » / brillance (plateau au-dessus de 10 kHz). */
  readonly airDb: number;
}

export const FLAT_EQ: VoiceEq = { lowCutHz: 0, bodyDb: 0, presenceDb: 0, airDb: 0 };

export const MAX_LOW_CUT_HZ = 300;
export const MAX_EQ_DB = 12;

const BODY_HZ = 250;
const PRESENCE_HZ = 3500;
const AIR_HZ = 10000;
/** Largeur des cloches : environ une octave et demie. */
const BELL_Q = 0.9;
const LOW_CUT_Q = 0.707;

export interface BiquadSpec {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly gain: number;
  readonly Q: number;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
}

/** Ramène chaque réglage dans ses bornes (valeur non numérique : neutre). */
export function sanitizeEq(eq: Partial<VoiceEq>): VoiceEq {
  return {
    lowCutHz: clamp(eq.lowCutHz ?? 0, 0, MAX_LOW_CUT_HZ),
    bodyDb: clamp(eq.bodyDb ?? 0, -MAX_EQ_DB, MAX_EQ_DB),
    presenceDb: clamp(eq.presenceDb ?? 0, -MAX_EQ_DB, MAX_EQ_DB),
    airDb: clamp(eq.airDb ?? 0, -MAX_EQ_DB, MAX_EQ_DB),
  };
}

export function isFlatEq(eq: VoiceEq): boolean {
  return eq.lowCutHz <= 0 && eq.bodyDb === 0 && eq.presenceDb === 0 && eq.airDb === 0;
}

/** Filtres à enchaîner pour un réglage donné ; les bandes neutres sont omises. */
export function eqFilterSpecs(eq: VoiceEq): BiquadSpec[] {
  const safe = sanitizeEq(eq);
  const specs: BiquadSpec[] = [];
  if (safe.lowCutHz > 0) {
    specs.push({ type: 'highpass', frequency: safe.lowCutHz, gain: 0, Q: LOW_CUT_Q });
  }
  if (safe.bodyDb !== 0) {
    specs.push({ type: 'peaking', frequency: BODY_HZ, gain: safe.bodyDb, Q: BELL_Q });
  }
  if (safe.presenceDb !== 0) {
    specs.push({ type: 'peaking', frequency: PRESENCE_HZ, gain: safe.presenceDb, Q: BELL_Q });
  }
  if (safe.airDb !== 0) {
    specs.push({ type: 'highshelf', frequency: AIR_HZ, gain: safe.airDb, Q: BELL_Q });
  }
  return specs;
}

/**
 * Applique l'égaliseur hors temps réel (OfflineAudioContext) à une voix mono.
 * Renvoie l'entrée telle quelle si le réglage est neutre.
 */
export async function applyVoiceEq(samples: Float32Array<ArrayBuffer>, sampleRate: number, eq: VoiceEq): Promise<Float32Array<ArrayBuffer>> {
  const specs = eqFilterSpecs(eq);
  if (specs.length === 0 || samples.length === 0) {
    return samples;
  }
  const context = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  let node: AudioNode = source;
  for (const spec of specs) {
    const filter = context.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = Math.min(spec.frequency, sampleRate / 2 - 1);
    filter.gain.value = spec.gain;
    filter.Q.value = spec.Q;
    node = node.connect(filter);
  }
  node.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}
