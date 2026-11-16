import { DrumVoice } from './drum-pattern';

/**
 * Batterie synthétisée en code : aucun sample téléchargé, donc aucune question
 * de licence pour le prototype. Les fonctions acceptent un BaseAudioContext :
 * le même code sert à l'écoute (AudioContext) et à l'export (OfflineAudioContext),
 * ce qui garantit que le fichier exporté correspond à ce qui est entendu.
 */

/** Plancher des enveloppes : une rampe exponentielle ne peut pas atteindre 0. */
const SILENCE_GAIN = 0.001;
const NOISE_SECONDS = 0.5;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

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

function envelope(context: BaseAudioContext, peak: number, time: number, decaySeconds: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, time + decaySeconds);
  return gain;
}

function playKick(context: BaseAudioContext, output: AudioNode, time: number): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(150, time);
  oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  oscillator.connect(envelope(context, 0.9, time, 0.45)).connect(output);
  oscillator.start(time);
  oscillator.stop(time + 0.5);
}

function playNoise(
  context: BaseAudioContext,
  output: AudioNode,
  time: number,
  highpassHz: number,
  peak: number,
  decaySeconds: number,
): void {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpassHz;
  source.connect(filter).connect(envelope(context, peak, time, decaySeconds)).connect(output);
  source.start(time);
  source.stop(time + decaySeconds + 0.02);
}

function playSnare(context: BaseAudioContext, output: AudioNode, time: number): void {
  playNoise(context, output, time, 1200, 0.5, 0.18);
  const body = context.createOscillator();
  body.type = 'triangle';
  body.frequency.value = 185;
  body.connect(envelope(context, 0.35, time, 0.08)).connect(output);
  body.start(time);
  body.stop(time + 0.1);
}

/** Déclenche une frappe à la date `time` (secondes, horloge du contexte). */
export function playDrumHit(context: BaseAudioContext, output: AudioNode, voice: DrumVoice, time: number): void {
  switch (voice) {
    case 'kick':
      playKick(context, output, time);
      break;
    case 'snare':
      playSnare(context, output, time);
      break;
    case 'hihat':
      playNoise(context, output, time, 7000, 0.22, 0.05);
      break;
  }
}
