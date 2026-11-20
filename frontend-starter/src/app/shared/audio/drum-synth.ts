import { DrumKit, DrumVoice } from './drum-pattern';

/**
 * Batterie synthétisée en code : aucun sample téléchargé, donc aucune question
 * de licence. Les fonctions acceptent un BaseAudioContext : le même code sert à
 * l'écoute (AudioContext) et à l'export (OfflineAudioContext), ce qui garantit
 * que le fichier exporté correspond à ce qui est entendu.
 */

/** Plancher des enveloppes : une rampe exponentielle ne peut pas atteindre 0. */
const SILENCE_GAIN = 0.001;
const NOISE_SECONDS = 0.5;
/** Fondamentale de la 808 par défaut : la1 (55 Hz), si la tonalité n'est pas fournie. */
export const DEFAULT_BASS_HZ = 55;

/** Réglages de son d'une frappe : kit du pattern et note de la 808. */
export interface DrumSound {
  readonly kit: DrumKit;
  /** Fréquence de la 808 en hertz (fondamentale de la tonalité du projet, octave 1). */
  readonly bassHz: number;
}

export const DEFAULT_DRUM_SOUND: DrumSound = { kit: 'boomBap', bassHz: DEFAULT_BASS_HZ };

/**
 * Paramètres de chaque kit (fréquences en Hz, durées en s).
 * Boom bap : sons ronds et chauds ; trap : kick sec, hi-hats brillants et courts, 808 longue.
 */
export interface KitSettings {
  readonly kickStartHz: number;
  readonly kickEndHz: number;
  readonly kickDecay: number;
  readonly hihatHighpassHz: number;
  readonly hihatDecay: number;
  readonly bassDecay: number;
}

export const KIT_SETTINGS: Readonly<Record<DrumKit, KitSettings>> = {
  boomBap: { kickStartHz: 150, kickEndHz: 45, kickDecay: 0.45, hihatHighpassHz: 7000, hihatDecay: 0.05, bassDecay: 0.7 },
  trap: { kickStartHz: 190, kickEndHz: 52, kickDecay: 0.3, hihatHighpassHz: 9000, hihatDecay: 0.035, bassDecay: 1.4 },
};

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const saturationCurves = new WeakMap<BaseAudioContext, Float32Array<ArrayBuffer>>();

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * NOISE_SECONDS), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

/** Saturation douce (tanh) : ajoute des harmoniques pour que la 808 s'entende sur de petites enceintes. */
function saturationCurve(context: BaseAudioContext): Float32Array<ArrayBuffer> {
  let curve = saturationCurves.get(context);
  if (!curve) {
    const size = 1024;
    curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
    saturationCurves.set(context, curve);
  }
  return curve;
}

function envelope(context: BaseAudioContext, peak: number, time: number, decaySeconds: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, time + decaySeconds);
  return gain;
}

function playKick(context: BaseAudioContext, output: AudioNode, time: number, kit: KitSettings): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(kit.kickStartHz, time);
  oscillator.frequency.exponentialRampToValueAtTime(kit.kickEndHz, time + 0.12);
  oscillator.connect(envelope(context, 0.9, time, kit.kickDecay)).connect(output);
  oscillator.start(time);
  oscillator.stop(time + kit.kickDecay + 0.05);
}

function playNoise(
  context: BaseAudioContext,
  output: AudioNode,
  time: number,
  filterType: BiquadFilterType,
  frequency: number,
  peak: number,
  decaySeconds: number,
): void {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  source.connect(filter).connect(envelope(context, peak, time, decaySeconds)).connect(output);
  source.start(time);
  source.stop(time + decaySeconds + 0.02);
}

function playSnare(context: BaseAudioContext, output: AudioNode, time: number): void {
  playNoise(context, output, time, 'highpass', 1200, 0.5, 0.18);
  const body = context.createOscillator();
  body.type = 'triangle';
  body.frequency.value = 185;
  body.connect(envelope(context, 0.35, time, 0.08)).connect(output);
  body.start(time);
  body.stop(time + 0.1);
}

/** Clap : trois rafales de bruit rapprochées (les mains ne frappent pas exactement ensemble), puis une queue. */
function playClap(context: BaseAudioContext, output: AudioNode, time: number): void {
  [0, 0.011, 0.023].forEach(offset => playNoise(context, output, time + offset, 'bandpass', 1500, 0.45, 0.03));
  playNoise(context, output, time + 0.03, 'bandpass', 1300, 0.3, 0.16);
}

/** Percussion : tom court dont la hauteur descend légèrement. */
function playPercussion(context: BaseAudioContext, output: AudioNode, time: number): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(260, time);
  oscillator.frequency.exponentialRampToValueAtTime(180, time + 0.15);
  oscillator.connect(envelope(context, 0.55, time, 0.22)).connect(output);
  oscillator.start(time);
  oscillator.stop(time + 0.25);
}

/** 808 : sinus grave accordé sur la tonalité, léger glissement d'attaque et saturation douce. */
function playBass(context: BaseAudioContext, output: AudioNode, time: number, bassHz: number, kit: KitSettings): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(bassHz * 1.5, time);
  oscillator.frequency.exponentialRampToValueAtTime(bassHz, time + 0.05);
  const shaper = context.createWaveShaper();
  shaper.curve = saturationCurve(context);
  oscillator.connect(shaper).connect(envelope(context, 0.7, time, kit.bassDecay)).connect(output);
  oscillator.start(time);
  oscillator.stop(time + kit.bassDecay + 0.05);
}

/**
 * Déclenche une frappe à la date `time` (secondes, horloge du contexte).
 * `velocity` (0 à 1) règle la force de la frappe par un gain linéaire ;
 * `sound` choisit le kit et la note de la 808.
 */
export function playDrumHit(
  context: BaseAudioContext,
  output: AudioNode,
  voice: DrumVoice,
  time: number,
  velocity = 1,
  sound: DrumSound = DEFAULT_DRUM_SOUND,
): void {
  const kit = KIT_SETTINGS[sound.kit];
  const hit = context.createGain();
  hit.gain.value = Math.min(1, Math.max(0, velocity));
  hit.connect(output);
  switch (voice) {
    case 'kick':
      playKick(context, hit, time, kit);
      break;
    case 'snare':
      playSnare(context, hit, time);
      break;
    case 'clap':
      playClap(context, hit, time);
      break;
    case 'hihat':
      playNoise(context, hit, time, 'highpass', kit.hihatHighpassHz, 0.22, kit.hihatDecay);
      break;
    case 'perc':
      playPercussion(context, hit, time);
      break;
    case 'bass808':
      playBass(context, hit, time, sound.bassHz, kit);
      break;
  }
}
