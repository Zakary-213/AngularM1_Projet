import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { MAX_PATTERNS } from './drum-pattern';
import { StudioSessionService } from './studio-session.service';

describe('StudioSessionService — bibliothèque de patterns', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StudioSessionService, { provide: AudioEngineService, useValue: { suspend: async () => undefined, currentTime: () => 0 } }],
    });
    session = TestBed.inject(StudioSessionService);
  });

  it('crée un pattern vide et l’ouvre dans le Drum Rack', () => {
    const id = session.createPattern()!;
    expect(session.patterns().map(p => p.name)).toEqual(['Pattern 01', 'Pattern 02']);
    expect(session.editedPatternId()).toBe(id);
    expect(session.pattern().kick.every(v => v === 0)).toBe(true);
  });

  it('modifie seulement le pattern édité', () => {
    session.createPattern();
    session.cycleStep('snare', 0);
    expect(session.patterns()[1].steps.snare[0]).toBe(1);
    expect(session.patterns()[0].steps.snare[0]).toBe(0);
  });

  it('duplique et renomme un pattern', () => {
    const copy = session.duplicatePattern('pattern-1')!;
    expect(session.patterns().find(p => p.id === copy)?.name).toBe('Pattern 01 (copie)');
    expect(session.patterns().find(p => p.id === copy)?.steps).toEqual(session.patterns()[0].steps);
    expect(session.renamePattern(copy, '  Refrain ')).toBe(true);
    expect(session.patterns()[1].name).toBe('Refrain');
    expect(session.renamePattern(copy, '')).toBe(false);
  });

  it('refuse de supprimer un pattern joué par un clip ou le dernier pattern', () => {
    expect(session.deletePattern('pattern-1')).toContain('au moins un pattern');
    const other = session.createPattern()!;
    expect(session.deletePattern('pattern-1')).toContain('joué par 1 clip');
    expect(session.deletePattern(other)).toBeNull();
    expect(session.patterns().map(p => p.id)).toEqual(['pattern-1']);
    expect(session.editedPatternId()).toBe('pattern-1');
  });

  it('chaque clip joue son pattern ; changer le pattern d’un clip est annulable', () => {
    const refrain = session.createPattern()!;
    session.cycleStep('kick', 1);
    expect(session.patternAt(1)?.kick[1]).toBe(0); // le clip par défaut joue Pattern 01
    session.setDrumClipPattern('drums-1', refrain);
    expect(session.patternAt(1)?.kick[1]).toBe(1);
    expect(session.patternAt(8 * 16)).toBeNull(); // après le clip de 8 mesures : silence
    session.undo();
    expect(session.drumClips()[0].patternId).toBe('pattern-1');
  });

  it(`limite la bibliothèque à ${MAX_PATTERNS} patterns`, () => {
    for (let i = 1; i < MAX_PATTERNS; i++) session.createPattern();
    expect(session.createPattern()).toBeNull();
  });

  it('M3 : kit par pattern, copié à la duplication ; 808 accordée sur la tonalité', () => {
    session.setPatternKit('pattern-1', 'trap');
    const copy = session.duplicatePattern('pattern-1')!;
    expect(session.patterns().find(p => p.id === copy)?.kit).toBe('trap');
    session.projectKey.set({ root: 9, scale: 'minor' });
    expect(session.bassHz()).toBeCloseTo(55, 6); // la1
    session.projectKey.set({ root: 0, scale: 'major' });
    expect(session.bassHz()).toBeCloseTo(32.703, 3); // do1
  });
});
