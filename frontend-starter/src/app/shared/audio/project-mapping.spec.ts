import { describe, expect, it } from 'vitest';
import { createDemoPattern, toggleStep } from './drum-pattern';
import { StudioState, contentFingerprint, createEmptyPattern, fromProject, toProjectContent } from './project-mapping';
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
    expect(content.tracks[0].clips).toEqual([{ id: 'clip-drums', startBeat: 0, durationBeats: 4, patternId: 'pattern-1' }]);
    expect(content.tracks[0].volumeDb).toBe(-6);
    expect(content.tracks[2].mute).toBe(true);
    expect(content.patterns[0].drumRows.every(row => row.steps.length === 16)).toBe(true);
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
  });

  it('l’empreinte change avec une modification et revient à l’identique après annulation', () => {
    const before = contentFingerprint(state);
    const changed = { ...state, pattern: toggleStep(state.pattern, 'kick', 3) };
    expect(contentFingerprint(changed)).not.toBe(before);
    expect(contentFingerprint({ ...changed, pattern: toggleStep(changed.pattern, 'kick', 3) })).toBe(before);
  });
});
