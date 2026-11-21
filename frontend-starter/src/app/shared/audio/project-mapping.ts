import { DEFAULT_KIT, DEFAULT_PATTERN_ID, DRUM_KITS, DRUM_VOICES, DrumKit, DrumVoice, PatternEntry, createDemoPattern, createEmptyPattern } from './drum-pattern';

export { createEmptyPattern } from './drum-pattern';
import { BEATS_PER_BAR, DEFAULT_BPM, STEPS_PER_BAR, clampBpm } from './music-time';
import { SCALE_NAMES, ScaleName } from './pitch/musical-scale';
import { ProjectKey } from './pitch/vocal-styles';
import { STUDIO_TRACKS } from './studio-tracks';
import { DEFAULT_DRUM_CLIPS, DrumClip } from './arrangement';
import {
  DEFAULT_INSTRUMENT_PARAMS,
  INSTRUMENTS,
  InstrumentId,
  InstrumentTrackId,
  MELODIC_BAR_CHOICES,
  MelodicBars,
  MelodicPattern,
  MidiNote,
  addNote,
  clampParams,
  createDefaultMelodicPatterns,
} from './melodic-pattern';
import { InstrumentClips } from './note-scheduling';
import { FLAT_THREE_BAND_EQ, ThreeBandEq, clampEq } from './three-band-eq';
import { MixerState, TRACK_IDS, TrackId, TrackMix, clampTrackDb, createDefaultMixer } from './track-mix';
import { MusicalProject, ProjectClip, ProjectContent, ProjectPattern, ProjectTrackType } from '../models/musical-project.model';

/**
 * Conversion entre l'état sérialisable du studio et le format de sauvegarde v1.
 * Les objets audio (buffers, nœuds, prises) n'y figurent jamais : l'instrumentale
 * et les prises vocales sont référencées par l'identifiant de leur fichier dans
 * la bibliothèque (M6, M8).
 */

/** Instrumentale envoyée au serveur, telle qu'elle est référencée dans le projet. */
export interface InstrumentalRef {
  readonly fileId: string;
  /** Nom affiché (nom du fichier importé). */
  readonly label: string;
  /** Durée en temps au tempo du projet (informative : la lecture suit la durée réelle du fichier). */
  readonly durationBeats: number;
}

/** Prise vocale envoyée au serveur, telle qu'elle est référencée dans le projet. */
export interface TakeRef {
  readonly id: string;
  readonly fileId: string;
  readonly label: string;
  /** Position du début du fichier dans le morceau, en secondes (négative si la prise commence avant). */
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

export interface StudioState {
  readonly bpm: number;
  readonly key: ProjectKey;
  /** Bibliothèque de patterns (M3). */
  readonly patterns: readonly PatternEntry[];
  readonly mixer: MixerState;
  readonly instrumental: InstrumentalRef | null;
  readonly instrumentalEq: ThreeBandEq;
  readonly takes: readonly TakeRef[];
  /** Prise jouée sur la piste Voix, parmi `takes`, ou `null`. */
  readonly activeTakeId: string | null;
  /** Clips de la piste Batterie (M5). */
  readonly drumClips: readonly DrumClip[];
  /** Début de l'instrumentale, en temps. */
  readonly instrumentalStartBeat: number;
  /** Patterns du Piano Roll (M4), sauvegardés avec les patterns de batterie. */
  readonly melodicPatterns: readonly MelodicPattern[];
  /** Clips des pistes Mélodie et Basse (M4). */
  readonly instrumentClips: InstrumentClips;
}

const POSITION_DECIMALS = 10000;
const round = (value: number) => Math.round(value * POSITION_DECIMALS) / POSITION_DECIMALS;

/**
 * Position d'une prise en temps : le format n'accepte pas de début négatif, la part
 * qui précède le morceau (compensation de latence) va dans `offsetSeconds`.
 */
export function takeClipPosition(startSeconds: number, bpm: number): { startBeat: number; offsetSeconds: number } {
  return startSeconds >= 0
    ? { startBeat: round((startSeconds * bpm) / 60), offsetSeconds: 0 }
    : { startBeat: 0, offsetSeconds: round(-startSeconds) };
}

export function takeStartFromClip(startBeat: number, offsetSeconds: number, bpm: number): number {
  return (startBeat * 60) / bpm - offsetSeconds;
}

const MIN_CLIP_BEATS = 0.25;
const CLIP_LABEL_MAX_LENGTH = 120;

/** Durée d'un fichier en temps (beats) au tempo donné, arrondie au centième. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return Math.max(MIN_CLIP_BEATS, Math.round(((seconds * bpm) / 60) * 100) / 100);
}

const DEFAULT_KEY: ProjectKey = { root: 9, scale: 'minor' };
const DRUMS_CLIP_ID = 'clip-drums';
const INSTRUMENTAL_CLIP_ID = 'clip-instrumental';
const TRACK_TYPES: Readonly<Record<TrackId, ProjectTrackType>> = { drums: 'drum', melody: 'instrument', bass: 'instrument', instrumental: 'audio', voice: 'vocal' };

function patternClipsToProject(clips: readonly DrumClip[]): ProjectClip[] {
  return clips.map(clip => ({ id: clip.id, startBeat: clip.startBar * BEATS_PER_BAR, durationBeats: clip.lengthBars * BEATS_PER_BAR, patternId: clip.patternId }));
}

/** Pattern mélodique au format v1 : `drumRows` vide, notes MIDI sans leur identifiant d'exécution. */
function melodicPatternToProject(pattern: MelodicPattern): ProjectPattern {
  return {
    id: pattern.id,
    name: pattern.name,
    instrument: pattern.instrument,
    params: { ...pattern.params },
    bars: pattern.bars,
    drumRows: [],
    notes: pattern.notes.map(note => ({ pitch: note.pitch, startStep: note.startStep, durationSteps: note.durationSteps, velocity: note.velocity })),
  };
}

export function toProjectContent(state: StudioState): ProjectContent {
  return {
    bpm: state.bpm,
    key: { root: state.key.root, scale: state.key.scale },
    // `steps` reste lisible par les versions antérieures ; `velocities` porte la force des frappes.
    patterns: [
      ...state.patterns.map((pattern): ProjectPattern => ({
        id: pattern.id,
        name: pattern.name,
        kit: pattern.kit,
        drumRows: DRUM_VOICES.map(voice => ({ voice, steps: pattern.steps[voice].map(velocity => velocity > 0), velocities: [...pattern.steps[voice]] })),
      })),
      ...state.melodicPatterns.map(melodicPatternToProject),
    ],
    tracks: STUDIO_TRACKS.map(info => {
      const mix = state.mixer[info.id];
      const instrumental = info.id === 'instrumental' ? state.instrumental : null;
      return {
        id: info.id,
        name: info.name,
        type: TRACK_TYPES[info.id],
        color: info.color,
        volumeDb: mix.volumeDb,
        mute: mix.muted,
        solo: mix.solo,
        ...(info.id === 'instrumental' ? { eq: { ...state.instrumentalEq } } : {}),
        ...(info.id === 'voice' && state.activeTakeId && state.takes.some(take => take.id === state.activeTakeId) ? { activeClipId: state.activeTakeId } : {}),
        // Le pattern d'une mesure joue en boucle sur la batterie ; l'instrumentale démarre au début du morceau.
        clips:
          info.id === 'drums'
            ? patternClipsToProject(state.drumClips)
            : info.id === 'melody' || info.id === 'bass'
              ? patternClipsToProject(state.instrumentClips[info.id])
              : instrumental
              ? [{ id: INSTRUMENTAL_CLIP_ID, startBeat: state.instrumentalStartBeat, durationBeats: instrumental.durationBeats, offsetSeconds: 0, audioFileId: instrumental.fileId, label: instrumental.label.slice(0, CLIP_LABEL_MAX_LENGTH) }]
              : info.id === 'voice'
                ? state.takes.map(take => ({
                    id: take.id,
                    ...takeClipPosition(take.startSeconds, state.bpm),
                    durationBeats: secondsToBeats(take.durationSeconds, state.bpm),
                    audioFileId: take.fileId,
                    label: take.label.slice(0, CLIP_LABEL_MAX_LENGTH),
                  }))
                : [],
      };
    }),
  };
}

function isScale(value: unknown): value is ScaleName {
  return SCALE_NAMES.includes(value as ScaleName);
}

function readKey(project: MusicalProject): ProjectKey {
  const { root, scale } = project.key ?? {};
  return Number.isInteger(root) && root >= 0 && root <= 11 && isScale(scale) ? { root, scale } : DEFAULT_KEY;
}

function readRow(row: { steps?: readonly boolean[]; velocities?: readonly number[] }): number[] | null {
  if (row.velocities?.length === STEPS_PER_BAR) {
    return row.velocities.map(velocity => (Number.isFinite(velocity) ? Math.min(1, Math.max(0, velocity)) : 0));
  }
  // Projets antérieurs à la M3 : frappe = vélocité forte.
  return row.steps?.length === STEPS_PER_BAR ? row.steps.map(active => (active ? 1 : 0)) : null;
}

/** Un pattern stocké avec un instrument est un pattern mélodique (M4) ; sinon c'est un pattern de batterie. */
function isMelodic(stored: ProjectPattern): boolean {
  return typeof stored.instrument === 'string';
}

function readPatterns(project: MusicalProject): PatternEntry[] {
  const drumPatterns = (project.patterns ?? []).filter(stored => !isMelodic(stored));
  if (!drumPatterns.length) {
    // Nouveau projet : rythme de départ pour « Créer une prod », grille vide pour « Importer une prod ».
    return [{ id: DEFAULT_PATTERN_ID, name: 'Pattern 01', steps: project.origin === 'import' ? createEmptyPattern() : createDemoPattern(), kit: DEFAULT_KIT }];
  }
  return drumPatterns.map(stored => {
    const steps = createEmptyPattern() as Record<DrumVoice, readonly number[]>;
    for (const row of stored.drumRows ?? []) {
      const values = DRUM_VOICES.includes(row.voice as DrumVoice) ? readRow(row) : null;
      if (values) {
        steps[row.voice as DrumVoice] = values;
      }
    }
    // Kit absent (projet antérieur) ou inconnu : boom bap.
    const kit: DrumKit = DRUM_KITS.includes(stored.kit as DrumKit) ? (stored.kit as DrumKit) : DEFAULT_KIT;
    return { id: stored.id, name: stored.name || 'Pattern', steps, kit };
  });
}

/**
 * Patterns du Piano Roll. Un projet antérieur à la M4 reçoit les patterns de départ
 * (vides) ; un instrument inconnu devient le piano ; les notes invalides ou qui se
 * chevauchent sont ignorées plutôt que de rendre le projet illisible.
 */
function readMelodicPatterns(project: MusicalProject): MelodicPattern[] {
  const stored = (project.patterns ?? []).filter(isMelodic);
  if (!stored.length) {
    return createDefaultMelodicPatterns();
  }
  return stored.map(entry => {
    const instrument: InstrumentId = INSTRUMENTS.includes(entry.instrument as InstrumentId) ? (entry.instrument as InstrumentId) : 'piano';
    const bars: MelodicBars = MELODIC_BAR_CHOICES.includes(entry.bars as MelodicBars) ? (entry.bars as MelodicBars) : 1;
    let pattern: MelodicPattern = {
      id: entry.id,
      name: entry.name || 'Mélodie',
      instrument,
      params: clampParams(entry.params ?? {}, DEFAULT_INSTRUMENT_PARAMS[instrument]),
      bars,
      notes: [] as MidiNote[],
    };
    for (const note of entry.notes ?? []) {
      const result = addNote(pattern, note);
      if ('pattern' in result) {
        pattern = result.pattern;
      }
    }
    return pattern;
  });
}

/** Clips des pistes Mélodie et Basse ; un pattern inconnu est remplacé par le premier pattern mélodique. */
function readInstrumentClips(project: MusicalProject, patterns: readonly MelodicPattern[]): InstrumentClips {
  const readTrack = (track: InstrumentTrackId): DrumClip[] =>
    (project.tracks?.find(candidate => candidate.id === track)?.clips ?? [])
      .filter(clip => clip.patternId)
      .map(clip => ({
        id: clip.id,
        startBar: Math.max(0, Math.round(clip.startBeat / BEATS_PER_BAR)),
        lengthBars: Math.max(1, Math.round(clip.durationBeats / BEATS_PER_BAR)),
        patternId: patterns.some(pattern => pattern.id === clip.patternId) ? clip.patternId! : patterns[0].id,
      }))
      .sort((a, b) => a.startBar - b.startBar);
  return { melody: readTrack('melody'), bass: readTrack('bass') };
}

function readMixer(project: MusicalProject): MixerState {
  const mixer: Record<TrackId, TrackMix> = { ...createDefaultMixer() };
  for (const id of TRACK_IDS) {
    const track = project.tracks?.find(candidate => candidate.id === id);
    if (track) {
      mixer[id] = { volumeDb: clampTrackDb(track.volumeDb ?? 0), muted: Boolean(track.mute), solo: Boolean(track.solo) };
    }
  }
  return mixer;
}

/**
 * Clips de batterie. Jusqu'à la M5, le projet stockait un unique clip `clip-drums`
 * d'une mesure qui signifiait « le pattern boucle sans fin » : il devient
 * l'arrangement par défaut. Une piste Batterie vide reste vide (choix de l'utilisateur).
 */
function readDrumClips(project: MusicalProject, patterns: readonly PatternEntry[]): readonly DrumClip[] {
  const track = project.tracks?.find(candidate => candidate.id === 'drums');
  const fallbackPattern = patterns[0].id;
  if (!track) {
    return DEFAULT_DRUM_CLIPS.map(clip => ({ ...clip, patternId: fallbackPattern }));
  }
  const clips = track.clips.filter(clip => clip.patternId);
  const legacyLoop = clips.length === 1 && clips[0].id === DRUMS_CLIP_ID && clips[0].startBeat === 0 && clips[0].durationBeats === BEATS_PER_BAR;
  if (legacyLoop) {
    return DEFAULT_DRUM_CLIPS.map(clip => ({ ...clip, patternId: fallbackPattern }));
  }
  return clips
    .map(clip => ({
      id: clip.id,
      startBar: Math.max(0, Math.round(clip.startBeat / BEATS_PER_BAR)),
      lengthBars: Math.max(1, Math.round(clip.durationBeats / BEATS_PER_BAR)),
      // Pattern inconnu (supprimé, données abîmées) : le premier pattern du projet.
      patternId: patterns.some(pattern => pattern.id === clip.patternId) ? clip.patternId! : fallbackPattern,
    }))
    .sort((a, b) => a.startBar - b.startBar);
}

function readInstrumental(project: MusicalProject): { ref: InstrumentalRef | null; eq: ThreeBandEq; startBeat: number } {
  const track = project.tracks?.find(candidate => candidate.id === 'instrumental');
  const clip = track?.clips?.find(candidate => typeof candidate.audioFileId === 'string' && candidate.audioFileId.length > 0);
  const ref = clip
    ? { fileId: clip.audioFileId!, label: clip.label || 'Instrumentale', durationBeats: Math.max(MIN_CLIP_BEATS, clip.durationBeats) }
    : null;
  return { ref, eq: track?.eq ? clampEq(track.eq) : FLAT_THREE_BAND_EQ, startBeat: Math.max(0, Math.round(clip?.startBeat ?? 0)) };
}

function readTakes(project: MusicalProject, bpm: number): { takes: TakeRef[]; activeTakeId: string | null } {
  const track = project.tracks?.find(candidate => candidate.id === 'voice');
  const takes = (track?.clips ?? [])
    .filter(clip => typeof clip.audioFileId === 'string' && clip.audioFileId.length > 0)
    .map(clip => ({
      id: clip.id,
      fileId: clip.audioFileId!,
      label: clip.label || 'Prise',
      startSeconds: takeStartFromClip(clip.startBeat, clip.offsetSeconds ?? 0, bpm),
      durationSeconds: (Math.max(MIN_CLIP_BEATS, clip.durationBeats) * 60) / bpm,
    }));
  const activeTakeId = takes.some(take => take.id === track?.activeClipId) ? track!.activeClipId! : (takes.at(-1)?.id ?? null);
  return { takes, activeTakeId };
}

/** État du studio à partir d'un projet chargé ; les valeurs absentes ou invalides reprennent les défauts. */
export function fromProject(project: MusicalProject): StudioState {
  const bpm = Number.isFinite(project.bpm) ? clampBpm(project.bpm) : DEFAULT_BPM;
  const { takes, activeTakeId } = readTakes(project, bpm);
  const patterns = readPatterns(project);
  const melodicPatterns = readMelodicPatterns(project);
  return {
    bpm,
    key: readKey(project),
    patterns,
    mixer: readMixer(project),
    instrumental: readInstrumental(project).ref,
    instrumentalEq: readInstrumental(project).eq,
    takes,
    activeTakeId,
    drumClips: readDrumClips(project, patterns),
    instrumentalStartBeat: readInstrumental(project).startBeat,
    melodicPatterns,
    instrumentClips: readInstrumentClips(project, melodicPatterns),
  };
}

/** Empreinte comparable de l'état sauvegardable, pour détecter les modifications non sauvegardées. */
export function contentFingerprint(state: StudioState): string {
  return JSON.stringify(toProjectContent(state));
}
