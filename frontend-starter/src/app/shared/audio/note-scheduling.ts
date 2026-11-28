import { DrumClip } from './arrangement';
import { InstrumentId, InstrumentParams, InstrumentTrackId, MelodicPattern, isInstrumentTrackId, notesStartingAt, patternSteps } from './melodic-pattern';
import { STEPS_PER_BAR } from './music-time';

/**
 * Passage des patterns mélodiques et de leurs clips aux notes à jouer, pas par pas.
 * Même calcul pour la lecture (PatternTransport) et l'export (renderMix).
 */

/** Clips des pistes d'instruments : même forme que les clips de batterie (mesures, pattern joué). */
export type InstrumentClips = Readonly<Record<InstrumentTrackId, readonly DrumClip[]>>;

export const EMPTY_INSTRUMENT_CLIPS: InstrumentClips = { melody: [], bass: [] };

/** Note à déclencher à un pas, avec la piste qui la reçoit et le son de son pattern. */
export interface ScheduledNote {
  readonly track: InstrumentTrackId;
  readonly instrument: InstrumentId;
  readonly params: InstrumentParams;
  readonly pitch: number;
  readonly velocity: number;
  /** Durée jouée en pas : coupée à la fin du clip. */
  readonly durationSteps: number;
}

/** Clip qui joue au pas absolu `songStep` (le dernier commencé l'emporte, comme la batterie). */
function clipAt(clips: readonly DrumClip[], songStep: number): DrumClip | null {
  const bar = Math.floor(songStep / STEPS_PER_BAR);
  let found: DrumClip | null = null;
  for (const clip of clips) {
    if (bar >= clip.startBar && bar < clip.startBar + clip.lengthBars && (!found || clip.startBar >= found.startBar)) {
      found = clip;
    }
  }
  return found;
}

/**
 * Notes qui commencent au pas absolu `songStep`. Le pattern boucle dans son clip :
 * un pattern de 2 mesures dans un clip de 8 mesures est joué 4 fois.
 */
export function notesAtSongStep(clips: InstrumentClips, patterns: readonly MelodicPattern[], songStep: number): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  for (const [track, trackClips] of Object.entries(clips)) {
    if (!isInstrumentTrackId(track)) continue;
    const clip = clipAt(trackClips, songStep);
    const pattern = clip ? patterns.find(candidate => candidate.id === clip.patternId) : undefined;
    if (!clip || !pattern) {
      continue;
    }
    const clipStartStep = clip.startBar * STEPS_PER_BAR;
    const clipEndStep = (clip.startBar + clip.lengthBars) * STEPS_PER_BAR;
    const localStep = (songStep - clipStartStep) % patternSteps(pattern);
    for (const note of notesStartingAt(pattern, localStep)) {
      notes.push({
        track,
        instrument: pattern.instrument,
        params: pattern.params,
        pitch: note.pitch,
        velocity: note.velocity,
        durationSteps: Math.min(note.durationSteps, clipEndStep - songStep),
      });
    }
  }
  return notes;
}

/**
 * Écoute en boucle d'un pattern seul (Piano Roll) : ses notes à un pas, le
 * pattern étant répété depuis le début du morceau, sur la piste `track`.
 */
export function auditionNotesAt(pattern: MelodicPattern, track: InstrumentTrackId, songStep: number): ScheduledNote[] {
  return notesStartingAt(pattern, songStep % patternSteps(pattern)).map(note => ({
    track,
    instrument: pattern.instrument,
    params: pattern.params,
    pitch: note.pitch,
    velocity: note.velocity,
    durationSteps: note.durationSteps,
  }));
}

/** Pas joué dans un pattern au pas absolu `songStep`, d'après les clips qui le jouent ; -1 s'il ne joue pas. */
export function patternStepAt(clips: InstrumentClips, pattern: MelodicPattern, songStep: number): number {
  for (const trackClips of Object.values(clips)) {
    const clip = clipAt(trackClips, songStep);
    if (clip?.patternId === pattern.id) {
      return (songStep - clip.startBar * STEPS_PER_BAR) % patternSteps(pattern);
    }
  }
  return -1;
}

/** Nombre de clips (toutes pistes d'instruments) qui jouent un pattern. */
export function instrumentClipsUsing(clips: InstrumentClips, patternId: string): number {
  return Object.values(clips).reduce((count, trackClips) => count + trackClips.filter(clip => clip.patternId === patternId).length, 0);
}

export function instrumentClipsEndBar(clips: InstrumentClips): number {
  return Math.max(0, ...Object.values(clips).flatMap(trackClips => trackClips.map(clip => clip.startBar + clip.lengthBars)));
}
