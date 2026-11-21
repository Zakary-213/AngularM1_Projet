import { NOTE_NAMES, SEMITONES_PER_OCTAVE, pitchClass } from './pitch/musical-scale';
import { STEPS_PER_BAR } from './music-time';

/**
 * Patterns mélodiques du Piano Roll (M4) : notes de type MIDI jouées par un
 * instrument synthétisé. Unités : hauteur en numéro MIDI (60 = do4, 69 = la4 à 440 Hz),
 * début et durée en pas (doubles-croches) depuis le début du pattern, vélocité de 0 à 1.
 * Données sérialisables : les fonctions renvoient un nouveau pattern.
 */

export type InstrumentId = 'piano' | 'synth' | 'bass808';
export const INSTRUMENTS: readonly InstrumentId[] = ['piano', 'synth', 'bass808'];
export const INSTRUMENT_LABELS: Readonly<Record<InstrumentId, string>> = { piano: 'Piano', synth: 'Synthé', bass808: 'Basse 808' };

/** Pistes de la timeline qui jouent des patterns mélodiques. */
export type InstrumentTrackId = 'melody' | 'bass';
export const INSTRUMENT_TRACK_IDS: readonly InstrumentTrackId[] = ['melody', 'bass'];

/** Réglages de son d'un pattern, partagés par l'écoute et l'export. */
export interface InstrumentParams {
  /** Brillance (ouverture du filtre ; saturation pour la 808), de 0 à 1. */
  readonly tone: number;
  /** Durée de relâchement après la fin de la note, en secondes. */
  readonly releaseSeconds: number;
}

export const MIN_RELEASE_SECONDS = 0.02;
export const MAX_RELEASE_SECONDS = 2;

export const DEFAULT_INSTRUMENT_PARAMS: Readonly<Record<InstrumentId, InstrumentParams>> = {
  piano: { tone: 0.6, releaseSeconds: 0.3 },
  synth: { tone: 0.5, releaseSeconds: 0.25 },
  bass808: { tone: 0.4, releaseSeconds: 0.15 },
};

/** Tessiture affichée dans le Piano Roll (MIDI, bornes incluses). */
export interface PitchRange {
  readonly low: number;
  readonly high: number;
}

export const INSTRUMENT_RANGES: Readonly<Record<InstrumentId, PitchRange>> = {
  // Do3 à si5 : accords et mélodies.
  piano: { low: 48, high: 83 },
  synth: { low: 48, high: 83 },
  // Do1 à si2 : registre des basses de rap.
  bass808: { low: 24, high: 47 },
};

export interface MidiNote {
  /** Identifiant d'exécution (suivi des listes) ; non sauvegardé. */
  readonly id: string;
  readonly pitch: number;
  readonly startStep: number;
  readonly durationSteps: number;
  readonly velocity: number;
}

export type MelodicBars = 1 | 2 | 4;
export const MELODIC_BAR_CHOICES: readonly MelodicBars[] = [1, 2, 4];

export interface MelodicPattern {
  readonly id: string;
  readonly name: string;
  readonly instrument: InstrumentId;
  readonly params: InstrumentParams;
  /** Longueur du pattern en mesures : il boucle à l'intérieur de chaque clip. */
  readonly bars: MelodicBars;
  readonly notes: readonly MidiNote[];
}

/** Limite partagée avec le serveur (`PROJECT_LIMITS.maxNotesPerPattern`). */
export const MAX_NOTES_PER_PATTERN = 512;
export const MIN_MIDI_PITCH = 0;
export const MAX_MIDI_PITCH = 127;
export const DEFAULT_NOTE_VELOCITY = 0.8;
/** Longueurs proposées pour une nouvelle note, en pas (double-croche à ronde). */
export const NOTE_LENGTH_CHOICES = [1, 2, 4, 8, 16] as const;
export const DEFAULT_NOTE_LENGTH = 4;
export const DEFAULT_MELODY_PATTERN_ID = 'melody-1';
export const DEFAULT_BASS_PATTERN_ID = 'bass-1';

let noteCounter = 0;
export function createNoteId(): string {
  return `note-${++noteCounter}`;
}

export function createMelodicPatternId(): string {
  return `melodic-${crypto.randomUUID()}`;
}

export function patternSteps(pattern: Pick<MelodicPattern, 'bars'>): number {
  return pattern.bars * STEPS_PER_BAR;
}

/** Piste où se place un pattern par défaut : la 808 sur la piste Basse, le reste sur Mélodie. */
export function defaultTrackFor(instrument: InstrumentId): InstrumentTrackId {
  return instrument === 'bass808' ? 'bass' : 'melody';
}

export function createMelodicPattern(id: string, name: string, instrument: InstrumentId, bars: MelodicBars = 2): MelodicPattern {
  return { id, name, instrument, params: DEFAULT_INSTRUMENT_PARAMS[instrument], bars, notes: [] };
}

/** Patterns de départ d'un projet : une mélodie au piano et une ligne de 808, vides. */
export function createDefaultMelodicPatterns(): MelodicPattern[] {
  return [
    createMelodicPattern(DEFAULT_MELODY_PATTERN_ID, 'Mélodie 01', 'piano'),
    createMelodicPattern(DEFAULT_BASS_PATTERN_ID, 'Basse 01', 'bass808'),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampVelocity(velocity: number): number {
  return Number.isFinite(velocity) ? clamp(velocity, 0.05, 1) : DEFAULT_NOTE_VELOCITY;
}

export function clampParams(params: Partial<InstrumentParams>, fallback: InstrumentParams): InstrumentParams {
  const tone = Number.isFinite(params.tone) ? clamp(params.tone!, 0, 1) : fallback.tone;
  const releaseSeconds = Number.isFinite(params.releaseSeconds)
    ? clamp(params.releaseSeconds!, MIN_RELEASE_SECONDS, MAX_RELEASE_SECONDS)
    : fallback.releaseSeconds;
  return { tone, releaseSeconds };
}

function isValidPitch(pitch: number): boolean {
  return Number.isInteger(pitch) && pitch >= MIN_MIDI_PITCH && pitch <= MAX_MIDI_PITCH;
}

function sortNotes(notes: readonly MidiNote[]): MidiNote[] {
  return [...notes].sort((a, b) => a.startStep - b.startStep || a.pitch - b.pitch);
}

/** Deux notes de même hauteur ne se recouvrent pas (une touche ne peut pas être enfoncée deux fois). */
function overlaps(notes: readonly MidiNote[], candidate: Omit<MidiNote, 'id'>, ignoreId?: string): boolean {
  return notes.some(
    note =>
      note.id !== ignoreId &&
      note.pitch === candidate.pitch &&
      candidate.startStep < note.startStep + note.durationSteps &&
      note.startStep < candidate.startStep + candidate.durationSteps,
  );
}

/** Note de hauteur `pitch` qui sonne au pas `step`, ou `null`. */
export function noteAt(pattern: MelodicPattern, pitch: number, step: number): MidiNote | null {
  return pattern.notes.find(note => note.pitch === pitch && step >= note.startStep && step < note.startStep + note.durationSteps) ?? null;
}

export type AddNoteResult = { readonly pattern: MelodicPattern; readonly note: MidiNote } | { readonly error: string };

/**
 * Ajoute une note. La durée est raccourcie pour tenir dans le pattern ;
 * la note est refusée si elle sort du pattern, chevauche une note de même hauteur
 * ou si la limite de notes est atteinte.
 */
export function addNote(
  pattern: MelodicPattern,
  note: { pitch: number; startStep: number; durationSteps: number; velocity?: number },
  id = createNoteId(),
): AddNoteResult {
  const length = patternSteps(pattern);
  if (!isValidPitch(note.pitch) || !Number.isInteger(note.startStep) || note.startStep < 0 || note.startStep >= length) {
    return { error: 'Note hors du pattern.' };
  }
  if (pattern.notes.length >= MAX_NOTES_PER_PATTERN) {
    return { error: `${MAX_NOTES_PER_PATTERN} notes maximum par pattern.` };
  }
  const durationSteps = clamp(Math.round(note.durationSteps) || 1, 1, length - note.startStep);
  const created: MidiNote = { id, pitch: note.pitch, startStep: note.startStep, durationSteps, velocity: clampVelocity(note.velocity ?? DEFAULT_NOTE_VELOCITY) };
  if (overlaps(pattern.notes, created)) {
    return { error: 'Une note de même hauteur occupe déjà ce pas.' };
  }
  return { pattern: { ...pattern, notes: sortNotes([...pattern.notes, created]) }, note: created };
}

function replaceNote(pattern: MelodicPattern, id: string, change: (note: MidiNote) => MidiNote): MelodicPattern {
  const current = pattern.notes.find(note => note.id === id);
  if (!current) {
    return pattern;
  }
  const next = change(current);
  // Déplacement impossible (chevauchement) : la note reste où elle était.
  if (overlaps(pattern.notes, next, id)) {
    return pattern;
  }
  return { ...pattern, notes: sortNotes(pattern.notes.map(note => (note.id === id ? next : note))) };
}

/** Déplace une note de `deltaSteps` pas et `deltaPitch` demi-tons, sans sortir du pattern ni de la tessiture. */
export function moveNote(pattern: MelodicPattern, id: string, deltaSteps: number, deltaPitch: number, range: PitchRange = { low: MIN_MIDI_PITCH, high: MAX_MIDI_PITCH }): MelodicPattern {
  const length = patternSteps(pattern);
  return replaceNote(pattern, id, note => ({
    ...note,
    startStep: clamp(note.startStep + Math.round(deltaSteps), 0, length - note.durationSteps),
    pitch: clamp(note.pitch + Math.round(deltaPitch), range.low, range.high),
  }));
}

/** Allonge ou raccourcit une note par la fin (au moins un pas, jusqu'à la fin du pattern). */
export function resizeNote(pattern: MelodicPattern, id: string, deltaSteps: number): MelodicPattern {
  const length = patternSteps(pattern);
  return replaceNote(pattern, id, note => ({ ...note, durationSteps: clamp(note.durationSteps + Math.round(deltaSteps), 1, length - note.startStep) }));
}

export function setNoteVelocity(pattern: MelodicPattern, id: string, velocity: number): MelodicPattern {
  return replaceNote(pattern, id, note => ({ ...note, velocity: clampVelocity(velocity) }));
}

export function removeNote(pattern: MelodicPattern, id: string): MelodicPattern {
  return { ...pattern, notes: pattern.notes.filter(note => note.id !== id) };
}

/**
 * Change la longueur du pattern. En le raccourcissant, les notes qui commencent
 * après la fin sont retirées et les autres sont coupées à la fin.
 */
export function setPatternBars(pattern: MelodicPattern, bars: MelodicBars): MelodicPattern {
  const length = bars * STEPS_PER_BAR;
  const notes = pattern.notes
    .filter(note => note.startStep < length)
    .map(note => ({ ...note, durationSteps: Math.min(note.durationSteps, length - note.startStep) }));
  return { ...pattern, bars, notes };
}

/**
 * Change l'instrument. Les réglages reprennent ceux de l'instrument ; les notes
 * sont transposées par octaves pour rester dans la nouvelle tessiture.
 */
export function setPatternInstrument(pattern: MelodicPattern, instrument: InstrumentId): MelodicPattern {
  const range = INSTRUMENT_RANGES[instrument];
  const notes = pattern.notes.map(note => ({ ...note, pitch: fitPitchInRange(note.pitch, range) }));
  // Deux notes ramenées sur la même hauteur au même moment : on garde la première.
  const kept: MidiNote[] = [];
  for (const note of notes) {
    if (!overlaps(kept, note)) {
      kept.push(note);
    }
  }
  return { ...pattern, instrument, params: DEFAULT_INSTRUMENT_PARAMS[instrument], notes: sortNotes(kept) };
}

/** Ramène une hauteur dans la tessiture par octaves (conserve le nom de la note). */
export function fitPitchInRange(pitch: number, range: PitchRange): number {
  let fitted = pitch;
  while (fitted < range.low) {
    fitted += SEMITONES_PER_OCTAVE;
  }
  while (fitted > range.high) {
    fitted -= SEMITONES_PER_OCTAVE;
  }
  return clamp(fitted, range.low, range.high);
}

/** Notes qui commencent au pas `step` du pattern (lecture et export). */
export function notesStartingAt(pattern: MelodicPattern, step: number): MidiNote[] {
  return pattern.notes.filter(note => note.startStep === step);
}

/** Nom d'une note en notation française, octave scientifique : 60 → « Do4 », 69 → « La4 ». */
export function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitchClass(pitch)]}${Math.floor(pitch / SEMITONES_PER_OCTAVE) - 1}`;
}

/** Touche noire du clavier (do♯, mi♭, fa♯, la♭, si♭). */
export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(pitch));
}

/** Hauteurs affichées de haut en bas (aigu en haut, comme sur un Piano Roll). */
export function pitchRows(range: PitchRange): number[] {
  return Array.from({ length: range.high - range.low + 1 }, (_, index) => range.high - index);
}

/** Case visée par un pointeur dans la grille : pas (colonne) et hauteur (ligne), ou `null` hors grille. */
export function cellAtPoint(
  x: number,
  y: number,
  geometry: { readonly stepWidth: number; readonly rowHeight: number; readonly steps: number; readonly range: PitchRange },
): { step: number; pitch: number } | null {
  const step = Math.floor(x / geometry.stepWidth);
  const row = Math.floor(y / geometry.rowHeight);
  const pitch = geometry.range.high - row;
  if (x < 0 || y < 0 || step >= geometry.steps || pitch < geometry.range.low) {
    return null;
  }
  return { step, pitch };
}

/** Description d'une note pour les lecteurs d'écran (positions 1-indexées). */
export function describeNote(note: MidiNote): string {
  const bar = Math.floor(note.startStep / STEPS_PER_BAR) + 1;
  const stepInBar = (note.startStep % STEPS_PER_BAR) + 1;
  return `${noteName(note.pitch)}, mesure ${bar} pas ${stepInBar}, ${note.durationSteps} pas, vélocité ${Math.round(note.velocity * 100)} %`;
}
