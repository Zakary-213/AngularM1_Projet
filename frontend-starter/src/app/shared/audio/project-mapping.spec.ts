import { describe, expect, it } from 'vitest';
import { createDemoPattern, toggleStep } from './drum-pattern';
import { StudioState, contentFingerprint, createEmptyPattern, fromProject, secondsToBeats, takeClipPosition, takeStartFromClip, toProjectContent } from './project-mapping';
import { FLAT_THREE_BAND_EQ } from './three-band-eq';
import { createDefaultMixer, updateTrack } from './track-mix';
import { MusicalProject } from '../models/musical-project.model';

function project(overrides: Partial<MusicalProject> = {}): MusicalProject {
  return {
    id: 'p1',
    ownerId: 'u1',
    formatVersion: 1,
    title: 'Minuit',
    origin: 'create',
    revision: 0,
    bpm: 90,
    key: { root: 9, scale: 'minor' },
    tracks: [],
    patterns: [],
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

const state: StudioState = {
  bpm: 140,
  key: { root: 2, scale: 'harmonicMinor' },
  pattern: toggleStep(createDemoPattern(), 'snare', 0),
  mixer: updateTrack(updateTrack(createDefaultMixer(), 'drums', { volumeDb: -6, solo: true }), 'voice', { muted: true }),
  instrumental: { fileId: '64b0000000000000000000aa', label: 'beat.mp3', durationBeats: 186.67 },
  instrumentalEq: { lowDb: 3, midDb: -2, highDb: 1 },
  takes: [
    // Début négatif : la compensation de latence fait commencer la prise juste avant le morceau.
    { id: 'take-a', fileId: '64b0000000000000000000b1', label: 'Prise 1', startSeconds: -0.09, durationSeconds: 12 },
    { id: 'take-b', fileId: '64b0000000000000000000b2', label: 'Refrain', startSeconds: 6, durationSeconds: 30 },
  ],
  activeTakeId: 'take-b',
  drumClips: [
    { id: 'drums-intro', startBar: 0, lengthBars: 4 },
    { id: 'drums-refrain', startBar: 8, lengthBars: 8 },
  ],
  instrumentalStartBeat: 4,
};

describe('conversion studio ↔ format de sauvegarde v1', () => {
  it('retrouve exactement l’état du studio après un aller-retour', () => {
    const content = toProjectContent(state);
    expect(fromProject(project({ ...content }))).toEqual(state);
  });

  it('produit les trois pistes du studio et un clip de batterie qui référence le pattern', () => {
    const content = toProjectContent(state);
    expect(content.tracks.map(track => [track.id, track.type])).toEqual([
      ['drums', 'drum'],
      ['instrumental', 'audio'],
      ['voice', 'vocal'],
    ]);
    expect(content.tracks[0].clips).toEqual([
      { id: 'drums-intro', startBeat: 0, durationBeats: 16, patternId: 'pattern-1' },
      { id: 'drums-refrain', startBeat: 32, durationBeats: 32, patternId: 'pattern-1' },
    ]);
    expect(content.tracks[0].volumeDb).toBe(-6);
    expect(content.tracks[2].mute).toBe(true);
    expect(content.patterns[0].drumRows.every(row => row.steps.length === 16)).toBe(true);
  });

  it('référence l’instrumentale par son fichier et porte son égaliseur, sans octets audio', () => {
    const instrumental = toProjectContent(state).tracks.find(track => track.id === 'instrumental')!;
    expect(instrumental.eq).toEqual({ lowDb: 3, midDb: -2, highDb: 1 });
    expect(instrumental.clips).toEqual([
      { id: 'clip-instrumental', startBeat: 4, durationBeats: 186.67, offsetSeconds: 0, audioFileId: '64b0000000000000000000aa', label: 'beat.mp3' },
    ]);
    const noInstrumental = toProjectContent({ ...state, instrumental: null }).tracks.find(track => track.id === 'instrumental')!;
    expect(noInstrumental.clips).toEqual([]);
  });

  it('sauvegarde les prises envoyées comme clips de la piste Voix, avec la prise active', () => {
    const voice = toProjectContent(state).tracks.find(track => track.id === 'voice')!;
    expect(voice.activeClipId).toBe('take-b');
    expect(voice.clips).toEqual([
      { id: 'take-a', startBeat: 0, offsetSeconds: 0.09, durationBeats: 28, audioFileId: '64b0000000000000000000b1', label: 'Prise 1' },
      { id: 'take-b', startBeat: 14, offsetSeconds: 0, durationBeats: 70, audioFileId: '64b0000000000000000000b2', label: 'Refrain' },
    ]);
    const none = toProjectContent({ ...state, takes: [], activeTakeId: null }).tracks.find(track => track.id === 'voice')!;
    expect(none.clips).toEqual([]);
    expect(none.activeClipId).toBeUndefined();
  });

  it('position d’une prise : secondes ↔ temps, y compris un début négatif', () => {
    expect(takeClipPosition(6, 140)).toEqual({ startBeat: 14, offsetSeconds: 0 });
    expect(takeClipPosition(-0.25, 140)).toEqual({ startBeat: 0, offsetSeconds: 0.25 });
    expect(takeStartFromClip(14, 0, 140)).toBeCloseTo(6, 9);
    expect(takeStartFromClip(0, 0.25, 140)).toBe(-0.25);
  });

  it('prise active absente ou inconnue : la dernière prise devient active', () => {
    const content = toProjectContent(state);
    const voice = content.tracks.find(track => track.id === 'voice')!;
    const loaded = fromProject(project({ ...content, tracks: content.tracks.map(track => (track.id === 'voice' ? { ...voice, activeClipId: 'inconnue' } : track)) }));
    expect(loaded.activeTakeId).toBe('take-b');
  });

  it('M5 : un ancien projet (pattern en boucle sans fin) reçoit l’arrangement par défaut', () => {
    const legacy = fromProject(project({ tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', clips: [{ id: 'clip-drums', startBeat: 0, durationBeats: 4, patternId: 'pattern-1' }] }] }));
    expect(legacy.drumClips).toEqual([{ id: 'drums-1', startBar: 0, lengthBars: 8 }]);
    expect(fromProject(project()).drumClips).toEqual([{ id: 'drums-1', startBar: 0, lengthBars: 8 }]);
    const emptied = fromProject(project({ tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', clips: [] }] }));
    expect(emptied.drumClips).toEqual([]);
  });

  it('convertit une durée en temps au tempo du projet', () => {
    expect(secondsToBeats(60, 90)).toBe(90);
    expect(secondsToBeats(10, 140)).toBe(23.33);
    expect(secondsToBeats(0, 120)).toBe(0.25);
  });

  it('nouveau projet : rythme de départ pour « Créer », grille vide pour « Importer »', () => {
    expect(fromProject(project({ origin: 'create' })).pattern).toEqual(createDemoPattern());
    expect(fromProject(project({ origin: 'import' })).pattern).toEqual(createEmptyPattern());
  });

  it('remplace les valeurs invalides par les valeurs par défaut', () => {
    const loaded = fromProject(
      project({
        bpm: 999,
        key: { root: 14, scale: 'inconnue' as never },
        tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', volumeDb: 40, clips: [] }],
        patterns: [{ id: 'pattern-1', name: 'P', drumRows: [{ voice: 'cowbell', steps: [true] }, { voice: 'kick', steps: [true, false] }] }],
      }),
    );
    expect(loaded.bpm).toBe(200);
    expect(loaded.key).toEqual({ root: 9, scale: 'minor' });
    expect(loaded.mixer.drums.volumeDb).toBe(6);
    expect(loaded.pattern).toEqual(createEmptyPattern());
    expect(loaded.instrumental).toBeNull();
    expect(loaded.instrumentalEq).toEqual(FLAT_THREE_BAND_EQ);
    expect(loaded.takes).toEqual([]);
    expect(loaded.activeTakeId).toBeNull();
  });

  it('l’empreinte change avec une modification et revient à l’identique après annulation', () => {
    const before = contentFingerprint(state);
    const changed = { ...state, pattern: toggleStep(state.pattern, 'kick', 3) };
    expect(contentFingerprint(changed)).not.toBe(before);
    expect(contentFingerprint({ ...changed, pattern: toggleStep(changed.pattern, 'kick', 3) })).toBe(before);
  });
});
