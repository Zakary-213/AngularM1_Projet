import { DrumPattern, hitsAtStep } from './drum-pattern';
import { DrumSound } from './drum-synth';
import { playDrumHit } from './drum-synth';
import { playInstrumentNote } from './instrument-synth';
import { ScheduledNote } from './note-scheduling';
import { TrackClip, scheduleClip } from './mix-graph';
import { MixerGraph } from './mixer-graph';
import { STEPS_PER_BAR, barsToSeconds, stepDurationSeconds } from './music-time';
import { MixerState } from './track-mix';

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_CHANNELS = 2;
export const MAX_EXPORT_BARS = 16;

export interface MixDescription {
  /** Pattern et son joués à ce pas absolu (clips de la piste Batterie), ou `null` : batterie silencieuse. */
  readonly drumsAt: (songStep: number) => { readonly pattern: DrumPattern; readonly sound: DrumSound } | null;
  readonly bpm: number;
  /** Nombre de mesures rendues : le pattern d'une mesure est répété. */
  readonly bars: number;
  /** Notes des pistes d'instruments qui commencent à ce pas absolu (M4). */
  readonly notesAt?: (songStep: number) => readonly ScheduledNote[];
  /** Clips audio et leur piste. */
  readonly clips: readonly TrackClip[];
  /** Réglages du mixeur (volume, mute, solo, pan, égaliseur, effets), comme à l'écoute. */
  readonly mixer: MixerState;
  /** Volume Master linéaire (0 à 1). */
  readonly masterVolume: number;
}

/**
 * Rend le mix plus vite que le temps réel avec un OfflineAudioContext. Le graphe
 * (synthés de batterie et d'instruments, clips, mixeur `MixerGraph`) est construit avec les mêmes
 * fonctions que l'écoute : le fichier correspond au mix entendu. La traîne des effets au-delà
 * de la dernière mesure est coupée, comme le reste du morceau.
 */
export function renderMix(mix: MixDescription, sampleRate = EXPORT_SAMPLE_RATE): Promise<AudioBuffer> {
  if (!Number.isInteger(mix.bars) || mix.bars < 1 || mix.bars > MAX_EXPORT_BARS) {
    return Promise.reject(new RangeError(`Nombre de mesures invalide : ${mix.bars}`));
  }
  const durationSeconds = barsToSeconds(mix.bars, mix.bpm);
  const context = new OfflineAudioContext(EXPORT_CHANNELS, Math.ceil(durationSeconds * sampleRate), sampleRate);
  const graph = new MixerGraph(context, context.destination, { mixer: mix.mixer, masterVolume: mix.masterVolume, bpm: mix.bpm }, false);
  const drums = graph.trackInputs.drums;
  const stepSeconds = stepDurationSeconds(mix.bpm);
  for (let step = 0; step < mix.bars * STEPS_PER_BAR; step++) {
    const playing = mix.drumsAt(step);
    if (playing) {
      hitsAtStep(playing.pattern, step).forEach(hit => playDrumHit(context, drums, hit.voice, step * stepSeconds, hit.velocity, playing.sound));
    }
  }
  for (let step = 0; step < mix.bars * STEPS_PER_BAR; step++) {
    for (const note of mix.notesAt?.(step) ?? []) {
      playInstrumentNote(context, graph.trackInputs[note.track], note.instrument, note.pitch, step * stepSeconds, note.durationSteps * stepSeconds, note.velocity, note.params);
    }
  }
  mix.clips.forEach(({ track, clip }) => scheduleClip(context, graph.trackInputs[track], clip, 0));

  return context.startRendering();
}
