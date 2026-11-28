import { DEFAULT_KIT, DEFAULT_PATTERN_ID, DRUM_KITS, DRUM_VOICES, DrumKit, DrumVoice, PatternEntry, createDemoPattern, createEmptyPattern } from './drum-pattern';
import type { ProjectLyrics } from '../models/lyrics.model';

export { createEmptyPattern } from './drum-pattern';
import { BEATS_PER_BAR, DEFAULT_BPM, STEPS_PER_BAR, clampBpm } from './music-time';
import { SCALE_NAMES, ScaleName } from './pitch/musical-scale';
import { ProjectKey, UserVocalStyle } from './pitch/vocal-styles';
import { VoiceCorrectionState, readProjectVocal, toProjectVocal } from './pitch/voice-correction-state';
import { DEFAULT_INSTRUMENT_TRACKS, DEFAULT_VOCAL_TRACK, InstrumentTrack, VocalTrack, studioTracks } from './studio-tracks';
import { DEFAULT_DRUM_CLIPS, DrumClip } from './arrangement';
import {
  DEFAULT_INSTRUMENT_PARAMS,
  isInstrumentId,
  isInstrumentTrackId,
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
import { EMPTY_INSTRUMENT_CLIPS, InstrumentClips } from './note-scheduling';
import { MixerState, TrackId, TrackMix, VocalTrackId, clampMasterVolume, isVocalTrackId, sanitizeTrackMix } from './track-mix';
import { MusicalProject, ProjectClip, ProjectContent, ProjectPattern } from '../models/musical-project.model';

/**
 * Conversion entre l'état sérialisable du studio et le format de sauvegarde v2
 * (réglages du mixeur M7 inclus : pan, égaliseur et envois d'effets par piste, Master ;
 * correction vocale M9 et version corrigée de la prise active, M10). Un projet v1 se lit
 * de la même façon : les champs v2 absents reprennent leurs valeurs par défaut.
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
  readonly trackId?: VocalTrackId;
  readonly fileId: string;
  readonly label: string;
  /** Position du début du fichier dans le morceau, en secondes (négative si la prise commence avant). */
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

/** Version corrigée de la prise active, envoyée au serveur (fichier dérivé, l'original est conservé). */
export interface TakeCorrectionRef {
  readonly takeId: string;
  readonly fileId: string;
  readonly styleLabel: string;
  /** Jouée sur la piste Voix (écoute et export) au lieu de l'originale. */
  readonly enabled: boolean;
}

export interface StudioState {
  readonly instrumentTracks?: readonly InstrumentTrack[];
  readonly vocalTracks?: readonly VocalTrack[];
  readonly armedVocalTrackId?: VocalTrackId;
  readonly corrections?: readonly TakeCorrectionRef[];
  readonly lyrics?: ProjectLyrics;
  readonly bpm: number;
  readonly key: ProjectKey;
  /** Bibliothèque de patterns (M3). */
  readonly patterns: readonly PatternEntry[];
  readonly mixer: MixerState;
  /** Volume Master linéaire (0 à 1). */
  readonly masterVolume: number;
  readonly instrumental: InstrumentalRef | null;
  readonly takes: readonly TakeRef[];
  /** Prise jouée sur la piste Voix, parmi `takes`, ou `null`. */
  readonly activeTakeId: string | null;
  /** Clips de la piste Batterie (M5). */
  readonly drumClips: readonly DrumClip[];
  /** Début de l'instrumentale, en temps. */
  readonly instrumentalStartBeat: number;
  /** Patterns du Piano Roll (M4), sauvegardés avec les patterns de batterie. */
  readonly melodicPatterns: readonly MelodicPattern[];
  /** Clips de chaque piste d'instrument. */
  readonly instrumentClips: InstrumentClips;
  /** Réglages de la correction vocale (M9). */
  readonly vocal: VoiceCorrectionState;
  /** Styles personnels de correction, sauvegardés avec le projet. */
  readonly userStyles: readonly UserVocalStyle[];
  /** Version corrigée de la prise active, ou `null`. */
  readonly correction: TakeCorrectionRef | null;
}

const STYLE_LABEL_MAX_LENGTH = 60;

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
  const vocalTracks = state.vocalTracks ?? [{ ...DEFAULT_VOCAL_TRACK, activeTakeId: state.activeTakeId, settings: state.vocal }];
  const corrections = new Map((state.corrections ?? (state.correction ? [state.correction] : [])).map(correction => [correction.takeId, correction]));
  return {
    armedVocalTrackId: state.armedVocalTrackId ?? vocalTracks[0].id,
    ...(state.lyrics ? { lyrics: state.lyrics } : {}),
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
    tracks: studioTracks(vocalTracks, state.instrumentTracks).map(info => {
      const mix = state.mixer[info.id];
      const instrumental = info.id === 'instrumental' ? state.instrumental : null;
      const vocalTrack = vocalTracks.find(track => track.id === info.id);
      const takes = vocalTrack ? state.takes.filter(take => (take.trackId ?? 'voice') === vocalTrack.id) : [];
      return {
        id: info.id,
        name: info.name,
        type: info.id === 'drums' ? 'drum' : info.id === 'instrumental' ? 'audio' : vocalTrack ? 'vocal' : 'instrument',
        color: info.color,
        volumeDb: mix.volumeDb,
        mute: mix.muted,
        solo: mix.solo,
        pan: mix.pan,
        eq: { ...mix.eq },
        fx: { reverb: { ...mix.reverb }, delay: { ...mix.delay } },
        ...(vocalTrack ? {
          vocal: toProjectVocal(vocalTrack.settings, state.userStyles),
          ...(takes.some(take => take.id === vocalTrack.activeTakeId) ? { activeClipId: vocalTrack.activeTakeId! } : {}),
        } : {}),
        // Le pattern d'une mesure joue en boucle sur la batterie ; l'instrumentale démarre au début du morceau.
        clips:
          info.id === 'drums'
            ? patternClipsToProject(state.drumClips)
            : isInstrumentTrackId(info.id)
              ? patternClipsToProject(state.instrumentClips[info.id] ?? [])
              : instrumental
              ? [{ id: INSTRUMENTAL_CLIP_ID, startBeat: state.instrumentalStartBeat, durationBeats: instrumental.durationBeats, offsetSeconds: 0, audioFileId: instrumental.fileId, label: instrumental.label.slice(0, CLIP_LABEL_MAX_LENGTH) }]
              : takes.map(take => {
                const correction = corrections.get(take.id);
                return {
                    id: take.id,
                    ...takeClipPosition(take.startSeconds, state.bpm),
                    durationBeats: secondsToBeats(take.durationSeconds, state.bpm),
                    audioFileId: take.fileId,
                    label: take.label.slice(0, CLIP_LABEL_MAX_LENGTH),
                    ...(correction
                      ? {
                          correction: {
                            audioFileId: correction.fileId,
                            styleLabel: correction.styleLabel.slice(0, STYLE_LABEL_MAX_LENGTH),
                            enabled: correction.enabled,
                          },
                        }
                      : {}),
                };
              }),
      };
    }),
    master: { volume: state.masterVolume },
    vocal: toProjectVocal(state.vocal, state.userStyles),
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
    const instrument: InstrumentId = isInstrumentId(entry.instrument) ? entry.instrument : 'piano';
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

function readInstrumentTracks(project: MusicalProject): readonly InstrumentTrack[] {
  const stored = (project.tracks ?? []).flatMap(({ id, name, color, type }) =>
    type === 'instrument' && isInstrumentTrackId(id) ? [{ id, name, color }] : [],
  );
  const defaultColor = DEFAULT_INSTRUMENT_TRACKS[0].color;
  if (project.formatVersion >= 4 && stored.length) {
    return stored.map(track => ({ ...track, color: track.color ?? defaultColor }));
  }
  return DEFAULT_INSTRUMENT_TRACKS.map(fallback => {
    const saved = stored.find(track => track.id === fallback.id);
    return { ...fallback, name: saved?.name ?? fallback.name, color: saved?.color ?? fallback.color };
  });
}

/** Un pattern inconnu est remplacé par le premier pattern mélodique. */
function readInstrumentClips(project: MusicalProject, patterns: readonly MelodicPattern[], instruments: readonly InstrumentTrack[]): InstrumentClips {
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
  return { ...EMPTY_INSTRUMENT_CLIPS, ...Object.fromEntries(instruments.map(track => [track.id, readTrack(track.id)])) };
}

/** Réglages du mixeur ; un projet antérieur à la M7 (sans pan, égaliseur ni effets) reste neutre sur ces réglages. */
function readMixer(project: MusicalProject, voices: readonly VocalTrack[], sourceIds: ReadonlyMap<VocalTrackId, string>, instruments: readonly InstrumentTrack[]): MixerState {
  const mixer = {} as Record<TrackId, TrackMix>;
  for (const { id } of studioTracks(voices, instruments)) {
    const sourceId = isVocalTrackId(id) ? sourceIds.get(id) ?? id : id;
    const track = project.tracks?.find(candidate => candidate.id === sourceId);
    mixer[id] = sanitizeTrackMix({
      volumeDb: track?.volumeDb,
      muted: track?.mute,
      solo: track?.solo,
      pan: track?.pan,
      eq: track?.eq,
      reverb: track?.fx?.reverb,
      delay: track?.fx?.delay,
    });
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

function readInstrumental(project: MusicalProject): { ref: InstrumentalRef | null; startBeat: number } {
  const track = project.tracks?.find(candidate => candidate.id === 'instrumental');
  const clip = track?.clips?.find(candidate => typeof candidate.audioFileId === 'string' && candidate.audioFileId.length > 0);
  const ref = clip
    ? { fileId: clip.audioFileId!, label: clip.label || 'Instrumentale', durationBeats: Math.max(MIN_CLIP_BEATS, clip.durationBeats) }
    : null;
  return { ref, startBeat: Math.max(0, Math.round(clip?.startBeat ?? 0)) };
}

function readTakes(clips: readonly ProjectClip[], trackId: VocalTrackId, bpm: number): TakeRef[] {
  return clips
    .filter(clip => typeof clip.audioFileId === 'string' && clip.audioFileId.length > 0)
    .map(clip => ({
      id: clip.id,
      ...(trackId === 'voice' ? {} : { trackId }),
      fileId: clip.audioFileId!,
      label: clip.label || 'Prise',
      startSeconds: takeStartFromClip(clip.startBeat, clip.offsetSeconds ?? 0, bpm),
      durationSeconds: (Math.max(MIN_CLIP_BEATS, clip.durationBeats) * 60) / bpm,
    }));
}

function readCorrection(clip: ProjectClip): TakeCorrectionRef | null {
  const correction = clip.correction;
  if (!correction || typeof correction.audioFileId !== 'string' || !correction.audioFileId) {
    return null;
  }
  return {
    takeId: clip.id,
    fileId: correction.audioFileId,
    styleLabel: typeof correction.styleLabel === 'string' ? correction.styleLabel.slice(0, STYLE_LABEL_MAX_LENGTH) : '',
    enabled: correction.enabled === true,
  };
}

/** État du studio à partir d'un projet chargé ; les valeurs absentes ou invalides reprennent les défauts. */
export function fromProject(project: MusicalProject): StudioState & { readonly instrumentTracks: readonly InstrumentTrack[] } {
  const bpm = Number.isFinite(project.bpm) ? clampBpm(project.bpm) : DEFAULT_BPM;
  const vocalSources = (project.tracks ?? []).filter(track => track.type === 'vocal');
  const sourceIds = new Map<VocalTrackId, string>();
  const existingIds = new Set(vocalSources.map(track => track.id));
  const takes: TakeRef[] = [];
  const corrections: TakeCorrectionRef[] = [];
  const vocal = readProjectVocal(project.vocal);
  const vocalTracks = vocalSources.map((track, index): VocalTrack => {
    let id: VocalTrackId;
    if (isVocalTrackId(track.id)) {
      id = track.id;
    } else {
      id = `voice-legacy-${index}`;
      while (existingIds.has(id)) id = `${id}-legacy`;
    }
    sourceIds.set(id, track.id);
    const references = readTakes(track.clips, id, bpm);
    takes.push(...references);
    for (const clip of track.clips) {
      const correction = readCorrection(clip);
      if (correction) corrections.push(correction);
    }
    return {
      id,
      name: track.name,
      color: track.color ?? DEFAULT_VOCAL_TRACK.color,
      activeTakeId: references.some(take => take.id === track.activeClipId) ? track.activeClipId! : references.at(-1)?.id ?? null,
      settings: track.vocal ? readProjectVocal(track.vocal).state : index === 0 ? vocal.state : DEFAULT_VOCAL_TRACK.settings,
    };
  });
  if (!vocalTracks.length) vocalTracks.push({ ...DEFAULT_VOCAL_TRACK, settings: vocal.state });
  const armed = vocalTracks.find(track => sourceIds.get(track.id) === project.armedVocalTrackId && project.armedVocalTrackId) ?? vocalTracks[0];
  const patterns = readPatterns(project);
  const melodicPatterns = readMelodicPatterns(project);
  const instrumentTracks = readInstrumentTracks(project);
  return {
    instrumentTracks,
    vocalTracks,
    armedVocalTrackId: armed.id,
    corrections,
    lyrics: project.lyrics,
    bpm,
    key: readKey(project),
    patterns,
    mixer: readMixer(project, vocalTracks, sourceIds, instrumentTracks),
    masterVolume: clampMasterVolume(Number(project.master?.volume)),
    instrumental: readInstrumental(project).ref,
    takes,
    activeTakeId: armed.activeTakeId,
    drumClips: readDrumClips(project, patterns),
    instrumentalStartBeat: readInstrumental(project).startBeat,
    melodicPatterns,
    instrumentClips: readInstrumentClips(project, melodicPatterns, instrumentTracks),
    vocal: vocalTracks[0].settings,
    userStyles: vocal.userStyles,
    correction: corrections.find(correction => correction.takeId === armed.activeTakeId) ?? null,
  };
}

/** Empreinte comparable de l'état sauvegardable, pour détecter les modifications non sauvegardées. */
export function contentFingerprint(state: StudioState): string {
  return JSON.stringify(toProjectContent(state));
}
