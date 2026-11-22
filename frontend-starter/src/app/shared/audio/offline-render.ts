import { DrumPattern, hitsAtStep } from './drum-pattern';
import { DrumSound } from './drum-synth';
import { playDrumHit } from './drum-synth';
import { playInstrumentNote } from './instrument-synth';
import { ScheduledNote } from './note-scheduling';
import { TrackClip, scheduleClip } from './mix-graph';
import { MixerGraph } from './mixer-graph';
import { stepDurationSeconds } from './music-time';
import { MAX_EXPORT_SECONDS } from './song-length';
import { MixerState } from './track-mix';

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_CHANNELS = 2;
/** Nombre de points de progression signalés pendant le rendu. */
const PROGRESS_STEPS = 20;

export interface MixDescription {
  /** Pattern et son joués à ce pas absolu (clips de la piste Batterie), ou `null` : batterie silencieuse. */
  readonly drumsAt: (songStep: number) => { readonly pattern: DrumPattern; readonly sound: DrumSound } | null;
  readonly bpm: number;
  /** Durée rendue en secondes (tout le morceau, voir `exportLength`). */
  readonly durationSeconds: number;
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
 * fonctions que l'écoute : le fichier correspond au mix entendu. Tout ce qui dépasse
 * `durationSeconds` est coupé. `onProgress` reçoit la part rendue (0 à 1) quand le
 * navigateur sait suspendre un rendu hors temps réel (Chrome, Safari) ; sinon seul l'état
 * « rendu en cours » est connu.
 */
export function renderMix(mix: MixDescription, sampleRate = EXPORT_SAMPLE_RATE, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const durationSeconds = mix.durationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_EXPORT_SECONDS) {
    return Promise.reject(new RangeError(`Durée d'export invalide : ${durationSeconds} s`));
  }
  const context = new OfflineAudioContext(EXPORT_CHANNELS, Math.ceil(durationSeconds * sampleRate), sampleRate);
  const graph = new MixerGraph(context, context.destination, { mixer: mix.mixer, masterVolume: mix.masterVolume, bpm: mix.bpm }, false);
  const drums = graph.trackInputs.drums;
  const stepSeconds = stepDurationSeconds(mix.bpm);
  const totalSteps = Math.ceil(durationSeconds / stepSeconds);
  for (let step = 0; step < totalSteps; step++) {
    const playing = mix.drumsAt(step);
    if (playing) {
      hitsAtStep(playing.pattern, step).forEach(hit => playDrumHit(context, drums, hit.voice, step * stepSeconds, hit.velocity, playing.sound));
    }
  }
  for (let step = 0; step < totalSteps; step++) {
    for (const note of mix.notesAt?.(step) ?? []) {
      playInstrumentNote(context, graph.trackInputs[note.track], note.instrument, note.pitch, step * stepSeconds, note.durationSteps * stepSeconds, note.velocity, note.params);
    }
  }
  mix.clips.forEach(({ track, clip }) => scheduleClip(context, graph.trackInputs[track], clip, 0));
  if (onProgress) {
    scheduleProgress(context, durationSeconds, onProgress);
  }
  return context.startRendering();
}

/** Points d'arrêt réguliers du rendu, pour en afficher l'avancement. */
function scheduleProgress(context: OfflineAudioContext, durationSeconds: number, onProgress: (fraction: number) => void): void {
  if (typeof context.suspend !== 'function') {
    return; // Firefox : pas de suspension d'un rendu hors temps réel.
  }
  for (let index = 1; index < PROGRESS_STEPS; index++) {
    const fraction = index / PROGRESS_STEPS;
    context
      .suspend(fraction * durationSeconds)
      .then(() => {
        onProgress(fraction);
        return context.resume();
      })
      .catch((error: unknown) => console.warn('[export] progression indisponible', error));
  }
}
