import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_RANGES,
  MAX_NOTES_PER_PATTERN,
  MelodicPattern,
  addNote,
  cellAtPoint,
  clampParams,
  createMelodicPattern,
  describeNote,
  fitPitchInRange,
  isBlackKey,
  moveNote,
  noteAt,
  noteName,
  notesStartingAt,
  pitchRows,
  removeNote,
  resizeNote,
  setNoteVelocity,
  setPatternBars,
  setPatternInstrument,
} from './melodic-pattern';

function withNotes(pattern: MelodicPattern, notes: { pitch: number; startStep: number; durationSteps: number }[]): MelodicPattern {
  return notes.reduce((current, note, index) => {
    const result = addNote(current, note, `n${index + 1}`);
    if ('error' in result) {
      throw new Error(result.error);
    }
    return result.pattern;
  }, pattern);
}

const empty = () => createMelodicPattern('p1', 'Mélodie', 'piano', 2);

describe('notes du Piano Roll (M4)', () => {
  it('nomme les notes en français avec l’octave scientifique', () => {
    expect(noteName(60)).toBe('Do4');
    expect(noteName(69)).toBe('La4');
    expect(noteName(24)).toBe('Do1');
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(64)).toBe(false);
  });

  it('ajoute une note triée, avec la vélocité par défaut', () => {
    const pattern = withNotes(empty(), [{ pitch: 64, startStep: 8, durationSteps: 4 }, { pitch: 60, startStep: 0, durationSteps: 4 }]);
    expect(pattern.notes.map(note => note.startStep)).toEqual([0, 8]);
    expect(pattern.notes[0].velocity).toBe(0.8);
  });

  it('accepte un accord : plusieurs hauteurs au même pas (polyphonie)', () => {
    const pattern = withNotes(empty(), [
      { pitch: 60, startStep: 0, durationSteps: 8 },
      { pitch: 64, startStep: 0, durationSteps: 8 },
      { pitch: 67, startStep: 0, durationSteps: 8 },
    ]);
    expect(notesStartingAt(pattern, 0).map(note => note.pitch)).toEqual([60, 64, 67]);
  });

  it('refuse le chevauchement de deux notes de même hauteur et les notes hors du pattern', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 0, durationSteps: 4 }]);
    expect(addNote(pattern, { pitch: 60, startStep: 2, durationSteps: 2 })).toHaveProperty('error');
    expect(addNote(pattern, { pitch: 60, startStep: 32, durationSteps: 1 })).toHaveProperty('error');
    expect(addNote(pattern, { pitch: 128, startStep: 0, durationSteps: 1 })).toHaveProperty('error');
    expect(addNote(pattern, { pitch: 60, startStep: 4, durationSteps: 1 })).toHaveProperty('pattern');
  });

  it('raccourcit une note trop longue pour tenir dans le pattern', () => {
    const result = addNote(empty(), { pitch: 60, startStep: 30, durationSteps: 16 });
    expect('note' in result && result.note.durationSteps).toBe(2);
  });

  it('borne le nombre de notes', () => {
    let pattern = createMelodicPattern('p', 'P', 'piano', 4);
    for (let i = 0; i < MAX_NOTES_PER_PATTERN; i++) {
      const result = addNote(pattern, { pitch: i % 128, startStep: Math.floor(i / 128) * 8, durationSteps: 1 });
      pattern = 'pattern' in result ? result.pattern : pattern;
    }
    expect(pattern.notes).toHaveLength(MAX_NOTES_PER_PATTERN);
    expect(addNote(pattern, { pitch: 1, startStep: 40, durationSteps: 1 })).toEqual({ error: '512 notes maximum par pattern.' });
  });

  it('déplace une note sans sortir du pattern ni de la tessiture', () => {
    const pattern = withNotes(empty(), [{ pitch: 82, startStep: 28, durationSteps: 4 }]);
    const moved = moveNote(pattern, 'n1', 10, 5, INSTRUMENT_RANGES.piano);
    expect(moved.notes[0]).toMatchObject({ startStep: 28, pitch: 83 });
    expect(moveNote(pattern, 'n1', -100, -100, INSTRUMENT_RANGES.piano).notes[0]).toMatchObject({ startStep: 0, pitch: 48 });
  });

  it('ne déplace pas une note sur une note de même hauteur', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 0, durationSteps: 4 }, { pitch: 60, startStep: 8, durationSteps: 4 }]);
    expect(moveNote(pattern, 'n1', 6, 0)).toBe(pattern);
  });

  it('redimensionne une note entre un pas et la fin du pattern', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 24, durationSteps: 4 }]);
    expect(resizeNote(pattern, 'n1', 20).notes[0].durationSteps).toBe(8);
    expect(resizeNote(pattern, 'n1', -10).notes[0].durationSteps).toBe(1);
  });

  it('règle la vélocité entre 0,05 et 1 et supprime une note', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 0, durationSteps: 4 }]);
    expect(setNoteVelocity(pattern, 'n1', 3).notes[0].velocity).toBe(1);
    expect(setNoteVelocity(pattern, 'n1', 0).notes[0].velocity).toBe(0.05);
    expect(removeNote(pattern, 'n1').notes).toEqual([]);
  });

  it('retrouve la note qui sonne à une case', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 4, durationSteps: 4 }]);
    expect(noteAt(pattern, 60, 7)?.id).toBe('n1');
    expect(noteAt(pattern, 60, 8)).toBeNull();
  });

  it('raccourcir le pattern retire ou coupe les notes qui dépassent', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 12, durationSteps: 8 }, { pitch: 62, startStep: 20, durationSteps: 2 }]);
    const shortened = setPatternBars(pattern, 1);
    expect(shortened.notes).toEqual([expect.objectContaining({ pitch: 60, startStep: 12, durationSteps: 4 })]);
  });

  it('changer d’instrument ramène les notes dans sa tessiture par octaves', () => {
    const pattern = withNotes(empty(), [{ pitch: 57, startStep: 0, durationSteps: 4 }]);
    const bass = setPatternInstrument(pattern, 'bass808');
    expect(bass.instrument).toBe('bass808');
    expect(bass.notes[0].pitch).toBe(45); // la2
    expect(fitPitchInRange(10, INSTRUMENT_RANGES.piano)).toBe(58);
  });

  it('borne les réglages de l’instrument', () => {
    const fallback = { tone: 0.5, releaseSeconds: 0.3 };
    expect(clampParams({ tone: 4, releaseSeconds: 10 }, fallback)).toEqual({ tone: 1, releaseSeconds: 2 });
    expect(clampParams({ tone: Number.NaN }, fallback)).toEqual(fallback);
  });

  it('lit la case visée dans la grille (aigus en haut)', () => {
    const geometry = { stepWidth: 28, rowHeight: 22, steps: 32, range: INSTRUMENT_RANGES.piano };
    expect(cellAtPoint(0, 0, geometry)).toEqual({ step: 0, pitch: 83 });
    expect(cellAtPoint(28 * 5 + 3, 22 * 2 + 1, geometry)).toEqual({ step: 5, pitch: 81 });
    expect(cellAtPoint(28 * 32, 0, geometry)).toBeNull();
    expect(cellAtPoint(0, 22 * 36, geometry)).toBeNull();
    expect(pitchRows({ low: 60, high: 62 })).toEqual([62, 61, 60]);
  });

  it('décrit une note pour les lecteurs d’écran', () => {
    const pattern = withNotes(empty(), [{ pitch: 60, startStep: 18, durationSteps: 2 }]);
    expect(describeNote(pattern.notes[0])).toBe('Do4, mesure 2 pas 3, 2 pas, vélocité 80 %');
  });
});
