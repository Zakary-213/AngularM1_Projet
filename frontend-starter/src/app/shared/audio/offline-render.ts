import { DrumPattern, hitsAtStep } from './drum-pattern';
import { DrumSound } from './drum-synth';
import { playDrumHit } from './drum-synth';
import { playInstrumentNote } from './instrument-synth';
import { INSTRUMENT_TRACK_IDS, InstrumentTrackId } from './melodic-pattern';
import { ScheduledNote } from './note-scheduling';
import { AudioClip, createMasterChain, scheduleClip } from './mix-graph';
import { STEPS_PER_BAR, barsToSeconds, stepDurationSeconds } from './music-time';

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_CHANNELS = 2;
export const MAX_EXPORT_BARS = 16;

export interface MixDescription {
  /** Pattern et son joués à ce pas absolu (clips de la piste Batterie), ou `null` : batterie silencieuse. */
  readonly drumsAt: (songStep: number) => { readonly pattern: DrumPattern; readonly sound: DrumSound } | null;
  readonly bpm: number;
  /** Nombre de mesures rendues : le pattern d'une mesure est répété. */
  readonly bars: number;
  /** Gain linéaire de la piste batterie (volume, mute et solo déjà appliqués). Défaut : 1. */
  readonly drumsGain?: number;
  /** Notes des pistes d'instruments qui commencent à ce pas absolu (M4). */
  readonly notesAt?: (songStep: number) => readonly ScheduledNote[];
  /** Gains linéaires des pistes Mélodie et Basse (volume, mute et solo appliqués). Défaut : 1. */
  readonly instrumentGains?: Readonly<Record<InstrumentTrackId, number>>;
  /** Clips audio, avec le gain de leur piste déjà multiplié dans `gain`. */
  readonly clips: readonly AudioClip[];
}

/**
 * Rend le mix plus vite que le temps réel avec un OfflineAudioContext. Le graphe
 * (synthés de batterie et d'instruments, clips, Master) est construit avec les mêmes fonctions que
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
    const playing = mix.drumsAt(step);
    if (playing) {
      hitsAtStep(playing.pattern, step).forEach(hit => playDrumHit(context, drums, hit.voice, step * stepSeconds, hit.velocity, playing.sound));
    }
  }
  const instruments: Record<InstrumentTrackId, GainNode> = { melody: context.createGain(), bass: context.createGain() };
  for (const track of INSTRUMENT_TRACK_IDS) {
    instruments[track].gain.value = mix.instrumentGains?.[track] ?? 1;
    instruments[track].connect(master);
  }
  for (let step = 0; step < mix.bars * STEPS_PER_BAR; step++) {
    for (const note of mix.notesAt?.(step) ?? []) {
      playInstrumentNote(context, instruments[note.track], note.instrument, note.pitch, step * stepSeconds, note.durationSteps * stepSeconds, note.velocity, note.params);
    }
  }
  mix.clips.forEach(clip => scheduleClip(context, master, clip, 0));

  return context.startRendering();
}
