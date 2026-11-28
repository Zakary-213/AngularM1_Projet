import {
  MAX_NOTES_PER_PATTERN,
  MAX_MIDI_PITCH,
  MIN_MIDI_PITCH,
  MelodicPattern,
  MidiNote,
  PitchRange,
  clampVelocity,
  createNoteId,
  fitPitchInRange,
  patternSteps,
} from './melodic-pattern';

/**
 * Opérations du Piano Roll sur plusieurs notes à la fois (sélection, copier, coller).
 * Mêmes unités que melodic-pattern.ts : pas (doubles-croches) et numéros MIDI.
 * Fonctions pures : elles renvoient un nouveau pattern et ne modifient rien.
 */

/** Note copiée, relative au début du bloc copié (le bloc commence au pas 0). */
export interface ClipboardNote {
  readonly pitch: number;
  readonly offsetSteps: number;
  readonly durationSteps: number;
  readonly velocity: number;
}

export interface NoteClipboard {
  readonly notes: readonly ClipboardNote[];
  /** Longueur du bloc copié, en pas (du début de la première note à la fin de la dernière). */
  readonly lengthSteps: number;
}

const FULL_RANGE: PitchRange = { low: MIN_MIDI_PITCH, high: MAX_MIDI_PITCH };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function selected(pattern: MelodicPattern, ids: ReadonlySet<string>): MidiNote[] {
  return pattern.notes.filter(note => ids.has(note.id));
}

function sameSlot(a: Pick<MidiNote, 'pitch' | 'startStep' | 'durationSteps'>, b: Pick<MidiNote, 'pitch' | 'startStep' | 'durationSteps'>): boolean {
  return a.pitch === b.pitch && a.startStep < b.startStep + b.durationSteps && b.startStep < a.startStep + a.durationSteps;
}

/** Vrai si une des notes `moved` recouvre une note de même hauteur qui n'est pas dans `ignore`. */
function collides(notes: readonly MidiNote[], moved: readonly MidiNote[], ignore: ReadonlySet<string>): boolean {
  return moved.some(candidate => notes.some(note => !ignore.has(note.id) && sameSlot(note, candidate)));
}

/** Début (pas) et fin (pas exclu) d'un ensemble de notes ; `null` s'il est vide. */
export function notesSpan(notes: readonly MidiNote[]): { start: number; end: number } | null {
  if (notes.length === 0) {
    return null;
  }
  return {
    start: Math.min(...notes.map(note => note.startStep)),
    end: Math.max(...notes.map(note => note.startStep + note.durationSteps)),
  };
}

/**
 * Déplace toute la sélection. Le décalage est réduit pour que le groupe reste dans
 * le pattern et dans la tessiture, sans déformer les accords. Si le groupe déplacé
 * recouvre une autre note de même hauteur, rien ne bouge.
 */
export function moveNotes(pattern: MelodicPattern, ids: ReadonlySet<string>, deltaSteps: number, deltaPitch: number, range: PitchRange = FULL_RANGE): MelodicPattern {
  const group = selected(pattern, ids);
  const span = notesSpan(group);
  if (!span) {
    return pattern;
  }
  const length = patternSteps(pattern);
  const lowest = Math.min(...group.map(note => note.pitch));
  const highest = Math.max(...group.map(note => note.pitch));
  const steps = clamp(Math.round(deltaSteps), -span.start, length - span.end);
  const pitch = clamp(Math.round(deltaPitch), range.low - lowest, range.high - highest);
  if (steps === 0 && pitch === 0) {
    return pattern;
  }
  const moved = group.map(note => ({ ...note, startStep: note.startStep + steps, pitch: note.pitch + pitch }));
  if (collides(pattern.notes, moved, ids)) {
    return pattern;
  }
  const byId = new Map(moved.map(note => [note.id, note]));
  return { ...pattern, notes: pattern.notes.map(note => byId.get(note.id) ?? note) };
}

/** Allonge ou raccourcit chaque note sélectionnée par la fin (au moins un pas, jusqu'à la fin du pattern). */
export function resizeNotes(pattern: MelodicPattern, ids: ReadonlySet<string>, deltaSteps: number): MelodicPattern {
  const length = patternSteps(pattern);
  const resized = selected(pattern, ids).map(note => ({
    ...note,
    durationSteps: clamp(note.durationSteps + Math.round(deltaSteps), 1, length - note.startStep),
  }));
  if (collides(pattern.notes, resized, ids)) {
    return pattern;
  }
  const byId = new Map(resized.map(note => [note.id, note]));
  return { ...pattern, notes: pattern.notes.map(note => byId.get(note.id) ?? note) };
}

/** Donne la même vélocité à toutes les notes sélectionnées. */
export function setNotesVelocity(pattern: MelodicPattern, ids: ReadonlySet<string>, velocity: number): MelodicPattern {
  return { ...pattern, notes: pattern.notes.map(note => (ids.has(note.id) ? { ...note, velocity: clampVelocity(velocity) } : note)) };
}

/** Ajoute `delta` à la vélocité de chaque note sélectionnée (les écarts entre notes sont conservés). */
export function shiftNotesVelocity(pattern: MelodicPattern, ids: ReadonlySet<string>, delta: number): MelodicPattern {
  return { ...pattern, notes: pattern.notes.map(note => (ids.has(note.id) ? { ...note, velocity: clampVelocity(note.velocity + delta) } : note)) };
}

export function removeNotes(pattern: MelodicPattern, ids: ReadonlySet<string>): MelodicPattern {
  return { ...pattern, notes: pattern.notes.filter(note => !ids.has(note.id)) };
}

/** Copie les notes sélectionnées ; `null` si la sélection est vide. */
export function copyNotes(pattern: MelodicPattern, ids: ReadonlySet<string>): NoteClipboard | null {
  const group = selected(pattern, ids);
  const span = notesSpan(group);
  if (!span) {
    return null;
  }
  return {
    lengthSteps: span.end - span.start,
    notes: group.map(note => ({ pitch: note.pitch, offsetSteps: note.startStep - span.start, durationSteps: note.durationSteps, velocity: note.velocity })),
  };
}

export interface PasteResult {
  readonly pattern: MelodicPattern;
  /** Identifiants des notes collées (la nouvelle sélection). */
  readonly ids: readonly string[];
  /** Notes ignorées : hors du pattern, en chevauchement ou au-delà de la limite. */
  readonly skipped: number;
}

/**
 * Colle le presse-papiers à partir du pas `atStep`. Les hauteurs hors de la tessiture
 * de l'instrument sont ramenées d'une ou plusieurs octaves ; les notes qui
 * dépasseraient la fin du pattern ou recouvriraient une note existante sont ignorées.
 */
export function pasteNotes(pattern: MelodicPattern, clipboard: NoteClipboard, atStep: number, range: PitchRange = FULL_RANGE): PasteResult {
  const length = patternSteps(pattern);
  const notes = [...pattern.notes];
  const ids: string[] = [];
  let skipped = 0;
  for (const copied of clipboard.notes) {
    const startStep = atStep + copied.offsetSteps;
    const candidate: MidiNote = {
      id: createNoteId(),
      pitch: fitPitchInRange(copied.pitch, range),
      startStep,
      durationSteps: copied.durationSteps,
      velocity: clampVelocity(copied.velocity),
    };
    const fits = startStep >= 0 && startStep + copied.durationSteps <= length;
    if (!fits || notes.length >= MAX_NOTES_PER_PATTERN || notes.some(note => sameSlot(note, candidate))) {
      skipped++;
      continue;
    }
    notes.push(candidate);
    ids.push(candidate.id);
  }
  return { pattern: { ...pattern, notes }, ids, skipped };
}

/**
 * Notes touchées par le rectangle de sélection : pas `fromStep` à `toStep` (inclus)
 * et hauteurs `lowPitch` à `highPitch` (incluses), dans n'importe quel ordre.
 */
export function notesInBox(pattern: MelodicPattern, fromStep: number, toStep: number, lowPitch: number, highPitch: number): string[] {
  const [first, last] = fromStep <= toStep ? [fromStep, toStep] : [toStep, fromStep];
  const [low, high] = lowPitch <= highPitch ? [lowPitch, highPitch] : [highPitch, lowPitch];
  return pattern.notes
    .filter(note => note.pitch >= low && note.pitch <= high && note.startStep <= last && note.startStep + note.durationSteps - 1 >= first)
    .map(note => note.id);
}
