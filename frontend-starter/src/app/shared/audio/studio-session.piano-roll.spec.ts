import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { MAX_PATTERNS } from './drum-pattern';
import { DEFAULT_BASS_PATTERN_ID, DEFAULT_MELODY_PATTERN_ID } from './melodic-pattern';
import { notesAtSongStep } from './note-scheduling';
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

  it('ajoute un instrument en un geste : partie nommée, ouverte et placée sur la bonne piste', () => {
    const guitar = session.addInstrument('acousticGuitar')!;
    expect(guitar.track).toBe('melody');
    expect(guitar.clipId).not.toBeNull();
    expect(session.editedMelodicPattern()).toMatchObject({ id: guitar.patternId, name: 'Guitare acoustique 01', instrument: 'acousticGuitar' });
    expect(session.instrumentClips().melody.map(clip => clip.patternId)).toEqual([guitar.patternId]);

    const bass = session.addInstrument('electricBass')!;
    expect(bass.track).toBe('bass');
    expect(session.instrumentClips().bass.map(clip => clip.patternId)).toEqual([bass.patternId]);
    expect(session.addInstrument('acousticGuitar')!.patternId).not.toBe(guitar.patternId);
    expect(session.editedMelodicPattern().name).toBe('Guitare acoustique 02');
  });

  it('ne recouvre pas une partie déjà placée : le nouvel instrument va après le dernier clip de la piste', () => {
    const piano = session.addInstrument('piano')!;
    expect(piano.startBar).toBe(0);
    const strings = session.addInstrument('strings')!;
    expect(strings.startBar).toBe(4);
    expect(session.instrumentClips().melody.map(clip => [clip.patternId, clip.startBar])).toEqual([
      [piano.patternId, 0],
      [strings.patternId, 4],
    ]);
    // Autre piste : la basse démarre à la tête de lecture.
    expect(session.addInstrument('bass808')!.startBar).toBe(0);
  });

  it('refuse d’ajouter un instrument quand la limite de patterns est atteinte', () => {
    while (session.createMelodicPattern()) {
      // remplit jusqu'à la limite partagée
    }
    expect(session.addInstrument('flute')).toBeNull();
  });

  it('joue deux pistes d’instruments sur les mêmes mesures et garde le piano après suppression de la guitare', () => {
    const piano = session.addInstrument('piano', 'new')!;
    session.addNote(60, 0, 4);
    const guitar = session.addInstrument('acousticGuitar', 'new')!;
    session.addNote(55, 0, 4);
    expect(guitar.track).not.toBe(piano.track);
    expect(session.selectedInstrumentTrack()?.id).toBe(guitar.track);
    expect(session.renameInstrumentTrack(guitar.track, '  Guitare refrain  ')).toBe(true);
    expect(session.selectedInstrumentTrack()?.name).toBe('Guitare refrain');
    const notes = () => notesAtSongStep(session.instrumentClips(), session.melodicPatterns(), 0);
    expect(notes().map(note => [note.track, note.pitch])).toEqual([[piano.track, 60], [guitar.track, 55]]);
    expect(session.tracksWithContent()).toContain(guitar.track);

    expect(session.removeInstrumentTrack(guitar.track)).toBe(true);
    expect(notes().map(note => note.track)).toEqual([piano.track]);
    expect(session.melodicPatterns().some(pattern => pattern.id === guitar.patternId)).toBe(true);
    session.undo();
    session.redo();
    expect(notes().map(note => note.track)).toEqual([piano.track]);
  });

  it('applique la limite totale avant d’ajouter une nouvelle piste ou partie', () => {
    while (session.canAddTrack()) expect(session.addInstrument('piano', 'new')).not.toBeNull();
    const count = session.melodicPatterns().length;
    expect(session.addInstrument('flute', 'new')).toBeNull();
    expect(session.addVocalTrack()).toBeNull();
    expect(session.melodicPatterns()).toHaveLength(count);
  });

  it('copie une phrase d’une partie et la colle dans une autre (presse-papiers partagé)', () => {
    const guitar = session.addInstrument('acousticGuitar')!;
    const first = session.addNote(52, 0, 4) as { id: string };
    const second = session.addNote(55, 4, 4) as { id: string };
    expect(session.copyNotes(new Set([first.id, second.id]))).toBe(2);
    const strings = session.addInstrument('strings')!;
    expect(session.editedMelodicPattern().id).toBe(strings.patternId);
    const pasted = session.pasteNotes(0)!;
    expect(pasted.ids).toHaveLength(2);
    expect(session.editedMelodicPattern().notes.map(n => [n.pitch, n.startStep])).toEqual([[52, 0], [55, 4]]);
    expect(session.melodicPatterns().find(p => p.id === guitar.patternId)!.notes).toHaveLength(2);
  });

  it('déplace et supprime plusieurs notes à la fois', () => {
    const a = session.addNote(60, 0, 4) as { id: string };
    const b = session.addNote(64, 0, 4) as { id: string };
    const ids = new Set([a.id, b.id]);
    session.moveNotes(ids, 4, 12);
    expect(session.editedMelodicPattern().notes.map(n => [n.pitch, n.startStep])).toEqual([[72, 4], [76, 4]]);
    session.removeNotes(ids);
    expect(session.editedMelodicPattern().notes).toEqual([]);
  });
});
