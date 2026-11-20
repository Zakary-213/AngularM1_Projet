import { DRUM_VOICES, DrumPattern, DrumVoice, createDemoPattern } from './drum-pattern';
import { BEATS_PER_BAR, DEFAULT_BPM, STEPS_PER_BAR, clampBpm } from './music-time';
import { SCALE_NAMES, ScaleName } from './pitch/musical-scale';
import { ProjectKey } from './pitch/vocal-styles';
import { STUDIO_TRACKS } from './studio-tracks';
import { MixerState, TRACK_IDS, TrackId, TrackMix, clampTrackDb, createDefaultMixer } from './track-mix';
import { MusicalProject, ProjectContent, ProjectTrackType } from '../models/musical-project.model';

/**
 * Conversion entre l'état sérialisable du studio et le format de sauvegarde v1.
 * Les objets audio (buffers, nœuds, prises) n'y figurent jamais : l'instrumentale
 * et les prises vocales seront référencées après leur upload (M6, M8).
 */

export interface StudioState {
  readonly bpm: number;
  readonly key: ProjectKey;
  readonly pattern: DrumPattern;
  readonly mixer: MixerState;
}

const DEFAULT_KEY: ProjectKey = { root: 9, scale: 'minor' };
const MAIN_PATTERN_ID = 'pattern-1';
const DRUMS_CLIP_ID = 'clip-drums';
const TRACK_TYPES: Readonly<Record<TrackId, ProjectTrackType>> = { drums: 'drum', instrumental: 'audio', voice: 'vocal' };

function emptyRow(): boolean[] {
  return Array.from({ length: STEPS_PER_BAR }, () => false);
}

export function createEmptyPattern(): DrumPattern {
  return { kick: emptyRow(), snare: emptyRow(), hihat: emptyRow() };
}

export function toProjectContent(state: StudioState): ProjectContent {
  return {
    bpm: state.bpm,
    key: { root: state.key.root, scale: state.key.scale },
    patterns: [
      {
        id: MAIN_PATTERN_ID,
        name: 'Pattern 01',
        drumRows: DRUM_VOICES.map(voice => ({ voice, steps: [...state.pattern[voice]] })),
      },
    ],
    tracks: STUDIO_TRACKS.map(info => {
      const mix = state.mixer[info.id];
      return {
        id: info.id,
        name: info.name,
        type: TRACK_TYPES[info.id],
        color: info.color,
        volumeDb: mix.volumeDb,
        mute: mix.muted,
        solo: mix.solo,
        // M1 : le pattern d'une mesure joue en boucle sur la piste batterie.
        clips: info.id === 'drums' ? [{ id: DRUMS_CLIP_ID, startBeat: 0, durationBeats: BEATS_PER_BAR, patternId: MAIN_PATTERN_ID }] : [],
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

function readPattern(project: MusicalProject): DrumPattern {
  const stored = project.patterns?.find(pattern => pattern.id === MAIN_PATTERN_ID) ?? project.patterns?.[0];
  if (!stored) {
    // Nouveau projet : rythme de départ pour « Créer une prod », grille vide pour « Importer une prod ».
    return project.origin === 'import' ? createEmptyPattern() : createDemoPattern();
  }
  const pattern = createEmptyPattern() as Record<DrumVoice, boolean[]>;
  for (const row of stored.drumRows ?? []) {
    if (DRUM_VOICES.includes(row.voice as DrumVoice) && row.steps?.length === STEPS_PER_BAR) {
      pattern[row.voice as DrumVoice] = row.steps.map(Boolean);
    }
  }
  return pattern;
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

/** État du studio à partir d'un projet chargé ; les valeurs absentes ou invalides reprennent les défauts. */
export function fromProject(project: MusicalProject): StudioState {
  return {
    bpm: Number.isFinite(project.bpm) ? clampBpm(project.bpm) : DEFAULT_BPM,
    key: readKey(project),
    pattern: readPattern(project),
    mixer: readMixer(project),
  };
}

/** Empreinte comparable de l'état sauvegardable, pour détecter les modifications non sauvegardées. */
export function contentFingerprint(state: StudioState): string {
  return JSON.stringify(toProjectContent(state));
}
