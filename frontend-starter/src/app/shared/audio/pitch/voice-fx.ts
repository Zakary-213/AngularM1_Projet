import { VoiceEq, eqFilterSpecs } from './voice-eq';

/**
 * « Espace » de la voix : réverbération et écho ajoutés après la correction et
 * l'égaliseur. Niveaux d'envoi linéaires (0 à 1), durées en secondes ou ms.
 * La réverbération est synthétisée (bruit à décroissance exponentielle) : aucun
 * fichier de réponse impulsionnelle à télécharger, donc aucune licence à gérer.
 */
export interface VoiceFx {
  /** Niveau de la réverbération ajoutée à la voix (0 = aucune). */
  readonly reverbMix: number;
  /** Durée de la réverbération (décroissance de 60 dB), en secondes. */
  readonly reverbSeconds: number;
  /** Niveau de l'écho (0 = aucun). */
  readonly delayMix: number;
  /** Temps entre deux répétitions de l'écho, en ms. */
  readonly delayMs: number;
  /** Part réinjectée à chaque répétition (0 = une seule, 0,8 = longue traîne). */
  readonly feedback: number;
}

export const DRY_FX: VoiceFx = { reverbMix: 0, reverbSeconds: 1.5, delayMix: 0, delayMs: 330, feedback: 0.3 };

export const FX_LIMITS = {
  minReverbSeconds: 0.3,
  maxReverbSeconds: 5,
  minDelayMs: 50,
  maxDelayMs: 1000,
  maxFeedback: 0.8,
} as const;

/** Pré-délai de la réverbération : la voix reste devant, l'espace arrive juste après. */
const REVERB_PREDELAY_SECONDS = 0.02;
/** Les répétitions d'écho s'assombrissent : passe-bas dans la boucle, comme un écho à bande. */
const DELAY_DAMPING_HZ = 4500;
/** Crête maximale du rendu : au-delà, la voix est baissée pour ne pas saturer le WAV. */
const MAX_PEAK = 0.98;
/** −60 dB en amplitude naturelle : ln(1000). */
const DECAY_60_DB = Math.log(1000);

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function sanitizeFx(fx: Partial<VoiceFx>): VoiceFx {
  return {
    reverbMix: clamp(Number(fx.reverbMix), 0, 1, DRY_FX.reverbMix),
    reverbSeconds: clamp(Number(fx.reverbSeconds), FX_LIMITS.minReverbSeconds, FX_LIMITS.maxReverbSeconds, DRY_FX.reverbSeconds),
    delayMix: clamp(Number(fx.delayMix), 0, 1, DRY_FX.delayMix),
    delayMs: clamp(Number(fx.delayMs), FX_LIMITS.minDelayMs, FX_LIMITS.maxDelayMs, DRY_FX.delayMs),
    feedback: clamp(Number(fx.feedback), 0, FX_LIMITS.maxFeedback, DRY_FX.feedback),
  };
}

export function isDryFx(fx: VoiceFx): boolean {
  return fx.reverbMix <= 0 && fx.delayMix <= 0;
}

/** Temps d'écho calé sur le tempo : `division` = fraction de noire (0,5 = croche). */
export function tempoDelayMs(bpm: number, division = 0.5): number {
  return Math.round((60000 / bpm) * division);
}

/**
 * Réponse impulsionnelle synthétique : pré-délai puis bruit qui décroît de 60 dB
 * en `seconds`. Générateur pseudo-aléatoire fixe : même réglage, même son.
 */
export function createReverbImpulse(sampleRate: number, seconds: number): Float32Array<ArrayBuffer> {
  const predelay = Math.round(REVERB_PREDELAY_SECONDS * sampleRate);
  const length = predelay + Math.max(1, Math.round(seconds * sampleRate));
  const impulse = new Float32Array(length);
  let seed = 12345;
  for (let i = predelay; i < length; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647) * 2 - 1;
    impulse[i] = noise * Math.exp((-DECAY_60_DB * (i - predelay)) / (seconds * sampleRate));
  }
  // Énergie normalisée : la durée change la longueur de la traîne, pas son volume.
  let energy = 0;
  for (const sample of impulse) {
    energy += sample * sample;
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < length; i++) {
    impulse[i] *= scale;
  }
  return impulse;
}

/** Réverbération synthétique prête à l'emploi (voix corrigée, envoi partagé du mixeur). */
export function createReverbConvolver(context: BaseAudioContext, seconds: number): ConvolverNode {
  const impulse = createReverbImpulse(context.sampleRate, seconds);
  const buffer = context.createBuffer(1, impulse.length, context.sampleRate);
  buffer.copyToChannel(impulse, 0);
  const convolver = context.createConvolver();
  // Énergie déjà normalisée par createReverbImpulse : pas de seconde normalisation.
  convolver.normalize = false;
  convolver.buffer = buffer;
  return convolver;
}

export interface EchoLoop {
  /** Entrée du delay. */
  readonly input: AudioNode;
  /** Répétitions (signal retardé seulement, sans le direct). */
  readonly output: AudioNode;
  readonly delay: DelayNode;
  readonly feedback: GainNode;
}

/**
 * Écho à répétitions : delay, passe-bas, puis réinjection d'une part `feedback`
 * dans le delay. Temps en ms, borné à FX_LIMITS.
 */
export function createEchoLoop(context: BaseAudioContext, delayMs: number, feedback: number): EchoLoop {
  const delay = context.createDelay(FX_LIMITS.maxDelayMs / 1000);
  delay.delayTime.value = clamp(delayMs, FX_LIMITS.minDelayMs, FX_LIMITS.maxDelayMs, DRY_FX.delayMs) / 1000;
  const damping = context.createBiquadFilter();
  damping.type = 'lowpass';
  damping.frequency.value = Math.min(DELAY_DAMPING_HZ, context.sampleRate / 2 - 1);
  const loop = context.createGain();
  loop.gain.value = clamp(feedback, 0, FX_LIMITS.maxFeedback, DRY_FX.feedback);
  delay.connect(damping);
  damping.connect(loop).connect(delay);
  return { input: delay, output: damping, delay, feedback: loop };
}

/** Baisse le signal si sa crête dépasse MAX_PEAK ; renvoie le gain appliqué. */
export function limitPeak(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak <= MAX_PEAK) {
    return 1;
  }
  const gain = MAX_PEAK / peak;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain;
  }
  return gain;
}

/**
 * Chaîne de la voix corrigée, rendue hors temps réel : égaliseur, puis envois
 * vers la réverbération et l'écho, mélangés au signal direct. La durée est
 * conservée (la traîne au-delà de la fin de la prise est coupée) pour que la
 * voix reste calée sur la timeline.
 */
export async function applyVoiceChain(samples: Float32Array<ArrayBuffer>, sampleRate: number, eq: VoiceEq, fx: VoiceFx): Promise<Float32Array<ArrayBuffer>> {
  const specs = eqFilterSpecs(eq);
  const safeFx = sanitizeFx(fx);
  if ((specs.length === 0 && isDryFx(safeFx)) || samples.length === 0) {
    return samples;
  }
  const context = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;

  let voice: AudioNode = source;
  for (const spec of specs) {
    const filter = context.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = Math.min(spec.frequency, sampleRate / 2 - 1);
    filter.gain.value = spec.gain;
    filter.Q.value = spec.Q;
    voice = voice.connect(filter);
  }
  voice.connect(context.destination);

  if (safeFx.reverbMix > 0) {
    const send = context.createGain();
    send.gain.value = safeFx.reverbMix;
    voice.connect(createReverbConvolver(context, safeFx.reverbSeconds)).connect(send).connect(context.destination);
  }

  if (safeFx.delayMix > 0) {
    const echo = createEchoLoop(context, safeFx.delayMs, safeFx.feedback);
    const send = context.createGain();
    send.gain.value = safeFx.delayMix;
    voice.connect(echo.input);
    echo.output.connect(send).connect(context.destination);
  }

  source.start();
  const rendered = await context.startRendering();
  const output = rendered.getChannelData(0).slice();
  limitPeak(output);
  return output;
}
