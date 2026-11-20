import { DrumPattern, voicesAtStep } from './drum-pattern';
import { playDrumHit } from './drum-synth';
import { AudioClip, createMasterChain, scheduleClip } from './mix-graph';
import { STEPS_PER_BAR, barsToSeconds, stepDurationSeconds } from './music-time';

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_CHANNELS = 2;
export const MAX_EXPORT_BARS = 16;

export interface MixDescription {
  readonly pattern: DrumPattern;
  readonly bpm: number;
  /** Nombre de mesures rendues : le pattern d'une mesure est répété. */
  readonly bars: number;
  /** Gain linéaire de la piste batterie (volume, mute et solo déjà appliqués). Défaut : 1. */
  readonly drumsGain?: number;
  /** La batterie joue-t-elle à ce pas absolu ? (clips de la piste Batterie). Par défaut : toujours. */
  readonly drumActive?: (songStep: number) => boolean;
  /** Clips audio, avec le gain de leur piste déjà multiplié dans `gain`. */
  readonly clips: readonly AudioClip[];
}

/**
 * Rend le mix plus vite que le temps réel avec un OfflineAudioContext. Le graphe
 * (synthé de batterie, clips, Master) est construit avec les mêmes fonctions que
 * l'écoute : le fichier correspond au mix entendu.
 */
export function renderMix(mix: MixDescription, sampleRate = EXPORT_SAMPLE_RATE): Promise<AudioBuffer> {
  if (!Number.isInteger(mix.bars) || mix.bars < 1 || mix.bars > MAX_EXPORT_BARS) {
    return Promise.reject(new RangeError(`Nombre de mesures invalide : ${mix.bars}`));
  }
  const durationSeconds = barsToSeconds(mix.bars, mix.bpm);
  const context = new OfflineAudioContext(EXPORT_CHANNELS, Math.ceil(durationSeconds * sampleRate), sampleRate);
  const master = createMasterChain(context);

  const drums = context.createGain();
  drums.gain.value = mix.drumsGain ?? 1;
  drums.connect(master);
  const stepSeconds = stepDurationSeconds(mix.bpm);
  for (let step = 0; step < mix.bars * STEPS_PER_BAR; step++) {
    if (mix.drumActive?.(step) ?? true) {
      voicesAtStep(mix.pattern, step).forEach(voice => playDrumHit(context, drums, voice, step * stepSeconds));
    }
  }
  mix.clips.forEach(clip => scheduleClip(context, master, clip, 0));

  return context.startRendering();
}
