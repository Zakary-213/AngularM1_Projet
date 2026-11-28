import { describe, expect, it } from 'vitest';
import { MelodicPattern, MidiNote, createMelodicPattern } from './melodic-pattern';
import { copyNotes, moveNotes, notesInBox, notesSpan, pasteNotes, removeNotes, resizeNotes, setNotesVelocity, shiftNotesVelocity } from './note-selection';

const note = (id: string, pitch: number, startStep: number, durationSteps = 4, velocity = 0.8): MidiNote => ({ id, pitch, startStep, durationSteps, velocity });

/** Pattern d'une mesure (16 pas) : un accord do-mi-sol au pas 0 et un la au pas 8. */
function pattern(notes: MidiNote[] = [note('c', 60, 0), note('e', 64, 0), note('g', 67, 0), note('a', 69, 8)]): MelodicPattern {
  return { ...createMelodicPattern('p', 'P', 'piano', 1), notes };
}

const chord = new Set(['c', 'e', 'g']);
const range = { low: 48, high: 83 };

describe('moveNotes', () => {
  it('déplace et transpose tout l’accord sans le déformer', () => {
    const moved = moveNotes(pattern(), chord, 2, 12, range);
    expect(moved.notes.filter(n => chord.has(n.id)).map(n => [n.pitch, n.startStep])).toEqual([[72, 2], [76, 2], [79, 2]]);
    expect(moved.notes.find(n => n.id === 'a')).toEqual(note('a', 69, 8));
  });

  it('réduit le décalage pour garder le groupe dans le pattern et la tessiture', () => {
    const moved = moveNotes(pattern(), chord, -5, 30, range);
    // Déjà au pas 0 ; sol (67) ne peut monter que de 16 demi-tons (83).
    expect(moved.notes.filter(n => chord.has(n.id)).map(n => [n.pitch, n.startStep])).toEqual([[76, 0], [80, 0], [83, 0]]);
  });

  it('ne bouge rien si le groupe recouvrirait une autre note', () => {
    const p = pattern();
    // Décalé de 8 pas et monté de 2 demi-tons, le sol (67 → 69) tomberait sur le la du pas 8.
    expect(moveNotes(p, chord, 8, 2, range)).toBe(p);
  });

  it('ignore une sélection vide', () => {
    const p = pattern();
    expect(moveNotes(p, new Set(), 4, 0, range)).toBe(p);
  });
});

describe('modifications groupées', () => {
  it('allonge toutes les notes sélectionnées, jusqu’à la fin du pattern', () => {
    const resized = resizeNotes(pattern(), new Set(['c', 'a']), 20);
    expect(resized.notes.find(n => n.id === 'c')!.durationSteps).toBe(16);
    expect(resized.notes.find(n => n.id === 'a')!.durationSteps).toBe(8);
  });

  it('règle ou décale la vélocité de la sélection', () => {
    expect(setNotesVelocity(pattern(), chord, 0.5).notes.map(n => n.velocity)).toEqual([0.5, 0.5, 0.5, 0.8]);
    const louder = shiftNotesVelocity(pattern([note('x', 60, 0, 4, 0.5), note('y', 62, 0, 4, 0.95)]), new Set(['x', 'y']), 0.1);
    expect(louder.notes.map(n => n.velocity)).toEqual([0.6, 1]);
  });

  it('supprime la sélection', () => {
    expect(removeNotes(pattern(), chord).notes.map(n => n.id)).toEqual(['a']);
  });
});

describe('copier et coller', () => {
  it('copie un bloc relatif à sa première note', () => {
    const clipboard = copyNotes(pattern(), new Set(['g', 'a']))!;
    expect(clipboard.lengthSteps).toBe(12);
    expect(clipboard.notes).toEqual([
      { pitch: 67, offsetSteps: 0, durationSteps: 4, velocity: 0.8 },
      { pitch: 69, offsetSteps: 8, durationSteps: 4, velocity: 0.8 },
    ]);
    expect(copyNotes(pattern(), new Set())).toBeNull();
  });

  it('colle l’accord à la suite, avec de nouveaux identifiants', () => {
    const clipboard = copyNotes(pattern(), chord)!;
    const result = pasteNotes(pattern(), clipboard, 4, range);
    expect(result.skipped).toBe(0);
    expect(result.ids).toHaveLength(3);
    expect(result.ids.some(id => chord.has(id))).toBe(false);
    const pasted = result.pattern.notes.filter(n => result.ids.includes(n.id));
    expect(pasted.map(n => [n.pitch, n.startStep])).toEqual([[60, 4], [64, 4], [67, 4]]);
  });

  it('ignore les notes qui dépassent la fin ou recouvrent une note existante', () => {
    const clipboard = copyNotes(pattern(), new Set(['a']))!;
    expect(pasteNotes(pattern(), clipboard, 14, range)).toMatchObject({ ids: [], skipped: 1 });
    expect(pasteNotes(pattern(), clipboard, 6, range)).toMatchObject({ ids: [], skipped: 1 });
  });

  it('ramène dans la tessiture une note collée vers un autre instrument', () => {
    const clipboard = copyNotes(pattern(), new Set(['c']))!;
    const bass = pasteNotes(pattern([]), clipboard, 0, { low: 24, high: 47 });
    expect(bass.pattern.notes[0].pitch).toBe(36);
  });
});

describe('rectangle de sélection', () => {
  it('trouve les notes touchées par le rectangle, dans n’importe quel sens', () => {
    expect(notesInBox(pattern(), 0, 3, 60, 64).sort()).toEqual(['c', 'e']);
    expect(notesInBox(pattern(), 10, 2, 70, 60).sort()).toEqual(['a', 'c', 'e', 'g']);
    expect(notesInBox(pattern(), 4, 7, 48, 83)).toEqual([]);
  });

  it('donne l’étendue d’un groupe de notes', () => {
    expect(notesSpan(pattern().notes)).toEqual({ start: 0, end: 12 });
    expect(notesSpan([])).toBeNull();
  });
});
