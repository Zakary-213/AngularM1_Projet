import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { MAX_PATTERNS } from './drum-pattern';
import { DEFAULT_BASS_PATTERN_ID, DEFAULT_MELODY_PATTERN_ID } from './melodic-pattern';
import { StudioSessionService } from './studio-session.service';

describe('StudioSessionService — Piano Roll et pistes d’instruments (M4)', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StudioSessionService,
        // Pas de vrai moteur audio : la préécoute échoue silencieusement pour le test (erreur journalisée).
        { provide: AudioEngineService, useValue: { suspend: async () => undefined, currentTime: () => 0, start: async () => Promise.reject(new Error('pas d’audio en test')) } },
      ],
    });
    session = TestBed.inject(StudioSessionService);
  });

  it('démarre avec une mélodie au piano et une basse 808, vides', () => {
    expect(session.melodicPatterns().map(pattern => [pattern.id, pattern.instrument, pattern.notes.length])).toEqual([
      [DEFAULT_MELODY_PATTERN_ID, 'piano', 0],
      [DEFAULT_BASS_PATTERN_ID, 'bass808', 0],
    ]);
    expect(session.editedMelodicPattern().id).toBe(DEFAULT_MELODY_PATTERN_ID);
  });

  it('ajoute, déplace, redimensionne et supprime une note du pattern affiché', () => {
    const added = session.addNote(60, 0, 4);
    expect('id' in added).toBe(true);
    const id = (added as { id: string }).id;
    session.moveNote(id, 2, 3);
    session.resizeNote(id, 4);
    expect(session.editedMelodicPattern().notes[0]).toMatchObject({ pitch: 63, startStep: 2, durationSteps: 8 });
    session.removeNote(id);
    expect(session.editedMelodicPattern().notes).toEqual([]);
    // Le pattern de basse n'a pas bougé.
    expect(session.melodicPatterns()[1].notes).toEqual([]);
  });

  it('renvoie un message quand une note est refusée', () => {
    session.addNote(60, 0, 4);
    expect(session.addNote(60, 1, 1)).toEqual({ error: 'Une note de même hauteur occupe déjà ce pas.' });
  });

  it('refuse de supprimer un pattern joué par un clip, accepte ensuite', () => {
    const clip = session.addInstrumentClipAtPlayhead('melody', DEFAULT_MELODY_PATTERN_ID)!;
    expect(session.deleteMelodicPattern(DEFAULT_MELODY_PATTERN_ID)).toBe('Ce pattern est joué par 1 clip : changez leur pattern ou supprimez-les d\'abord.');
    session.removeInstrumentClip('melody', clip);
    expect(session.deleteMelodicPattern(DEFAULT_MELODY_PATTERN_ID)).toBeNull();
    expect(session.melodicPatterns().map(pattern => pattern.id)).toEqual([DEFAULT_BASS_PATTERN_ID]);
    expect(session.deleteMelodicPattern(DEFAULT_BASS_PATTERN_ID)).toBe('Le projet garde au moins un pattern mélodique.');
  });

  it('les clips de mélodie et de basse sont annulables et allongent le morceau', () => {
    const clip = session.addInstrumentClipAtPlayhead('bass', DEFAULT_BASS_PATTERN_ID)!;
    session.moveInstrumentClip('bass', clip, 6);
    expect(session.instrumentClips().bass[0]).toMatchObject({ startBar: 6, lengthBars: 4 });
    expect(session.songEndStep()).toBe(10 * 16);
    session.undo();
    expect(session.instrumentClips().bass[0].startBar).toBe(0);
    session.undo();
    expect(session.instrumentClips().bass).toEqual([]);
    session.redo();
    expect(session.instrumentClips().bass).toHaveLength(1);
  });

  it('change l’instrument et les réglages d’un pattern, dans leurs bornes', () => {
    session.addNote(72, 0, 4);
    session.setMelodicInstrument(DEFAULT_MELODY_PATTERN_ID, 'bass808');
    expect(session.editedMelodicPattern().notes[0].pitch).toBe(36);
    session.setMelodicParams(DEFAULT_MELODY_PATTERN_ID, { tone: 5, releaseSeconds: 0 });
    expect(session.editedMelodicPattern().params).toEqual({ tone: 1, releaseSeconds: 0.02 });
  });

  it('partage la limite de patterns du format avec la batterie', () => {
    while (session.createPattern()) {
      // remplit la bibliothèque de batterie
    }
    expect(session.patterns().length + session.melodicPatterns().length).toBe(MAX_PATTERNS);
    expect(session.createMelodicPattern()).toBeNull();
  });
});
