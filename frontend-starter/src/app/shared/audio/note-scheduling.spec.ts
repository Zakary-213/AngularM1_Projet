import { describe, expect, it } from 'vitest';
import { filterCutoffHz, noteEnvelope, noteStopTime } from './instrument-synth';
import { MelodicPattern, addNote, createMelodicPattern } from './melodic-pattern';
import { auditionNotesAt, instrumentClipsEndBar, instrumentClipsUsing, notesAtSongStep, patternStepAt } from './note-scheduling';

function melody(): MelodicPattern {
  let pattern = createMelodicPattern('mel', 'Mélodie', 'piano', 2);
  for (const note of [
    { pitch: 60, startStep: 0, durationSteps: 8 },
    { pitch: 64, startStep: 0, durationSteps: 8 },
    { pitch: 67, startStep: 20, durationSteps: 16 },
  ]) {
    const result = addNote(pattern, note);
    pattern = 'pattern' in result ? result.pattern : pattern;
  }
  return pattern;
}

const bass = createMelodicPattern('bass', 'Basse', 'bass808', 1);
const bassLine = (() => {
  const result = addNote(bass, { pitch: 33, startStep: 0, durationSteps: 6 });
  return 'pattern' in result ? result.pattern : bass;
})();

describe('notes programmées depuis les clips (M4)', () => {
  const clips = {
    melody: [{ id: 'c1', startBar: 1, lengthBars: 4, patternId: 'mel' }],
    bass: [{ id: 'c2', startBar: 0, lengthBars: 2, patternId: 'bass' }],
  };

  it('joue un accord au premier pas du clip et la basse sur sa piste', () => {
    const notes = notesAtSongStep(clips, [melody(), bassLine], 16);
    expect(notes.filter(note => note.track === 'melody').map(note => note.pitch)).toEqual([60, 64]);
    expect(notes.find(note => note.track === 'bass')).toMatchObject({ pitch: 33, instrument: 'bass808', durationSteps: 6 });
  });

  it('fait boucler le pattern dans son clip', () => {
    // Pattern de 2 mesures dans un clip de 4 : il recommence à la mesure 4 (pas 48).
    expect(notesAtSongStep(clips, [melody()], 48).map(note => note.pitch)).toEqual([60, 64]);
    expect(notesAtSongStep(clips, [melody()], 17)).toEqual([]);
  });

  it('coupe une note qui dépasse la fin du clip', () => {
    const short = { melody: [{ id: 'c1', startBar: 0, lengthBars: 2, patternId: 'mel' }], bass: [] };
    expect(notesAtSongStep(short, [melody()], 20)[0].durationSteps).toBe(12);
  });

  it('ne joue rien hors des clips ou pour un pattern inconnu', () => {
    expect(notesAtSongStep(clips, [melody(), bassLine], 0).some(note => note.track === 'melody')).toBe(false);
    expect(notesAtSongStep({ melody: [{ id: 'x', startBar: 0, lengthBars: 1, patternId: 'absent' }], bass: [] }, [melody()], 0)).toEqual([]);
  });

  it('écoute seule : le pattern se répète depuis le début du morceau', () => {
    expect(auditionNotesAt(melody(), 'melody', 32).map(note => note.pitch)).toEqual([60, 64]);
    expect(auditionNotesAt(bassLine, 'bass', 16)).toHaveLength(1);
  });

  it('suit la position dans le pattern et compte les clips', () => {
    expect(patternStepAt(clips, melody(), 16 + 35)).toBe(3);
    expect(patternStepAt(clips, melody(), 0)).toBe(-1);
    expect(instrumentClipsUsing(clips, 'mel')).toBe(1);
    expect(instrumentClipsEndBar(clips)).toBe(5);
  });
});

describe('instruments synthétisés', () => {
  it('relâche la note après sa durée, même très courte', () => {
    const envelope = noteEnvelope('piano', { tone: 0.5, releaseSeconds: 0.3 });
    expect(noteStopTime(1, 0.5, envelope)).toBeCloseTo(1.8);
    expect(noteStopTime(1, 0, envelope)).toBeCloseTo(1 + envelope.attackSeconds + 0.3);
  });

  it('ouvre le filtre avec la brillance sans dépasser 16 kHz', () => {
    expect(filterCutoffHz('piano', 440, 1)).toBeGreaterThan(filterCutoffHz('piano', 440, 0));
    expect(filterCutoffHz('synth', 4000, 1)).toBe(16000);
  });
});
