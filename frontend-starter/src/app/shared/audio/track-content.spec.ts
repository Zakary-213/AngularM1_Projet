import { describe, expect, it } from 'vitest';
import { createEmptyPattern, createDemoPattern, PatternEntry } from './drum-pattern';
import { createMelodicPattern } from './melodic-pattern';
import { SongTracks, tracksWithContent } from './track-content';

const clip = (patternId: string) => ({ id: `clip-${patternId}`, startBar: 0, lengthBars: 1, patternId });
const drums = (id: string, empty: boolean): PatternEntry => ({ id, name: id, steps: empty ? createEmptyPattern() : createDemoPattern(), kit: 'boomBap' });
const melodic = (id: string, withNote: boolean) => ({
  ...createMelodicPattern(id, id, 'piano', 1),
  notes: withNote ? [{ id: 'n1', pitch: 60, startStep: 0, durationSteps: 4, velocity: 0.8 }] : [],
});

function song(overrides: Partial<SongTracks> = {}): SongTracks {
  return {
    drumClips: [],
    drumPatterns: [drums('beat', false), drums('vide', true)],
    instrumentClips: { melody: [], bass: [] },
    melodicPatterns: [melodic('air', true), melodic('rien', false)],
    hasInstrumental: false,
    hasTake: false,
    ...overrides,
  };
}

describe('tracksWithContent', () => {
  it('projet sans rien : aucune piste', () => {
    expect(tracksWithContent(song())).toEqual([]);
  });

  it('un clip vide ne compte pas (batterie sans frappe, partie sans note)', () => {
    expect(tracksWithContent(song({ drumClips: [clip('vide')], instrumentClips: { melody: [clip('rien')], bass: [] } }))).toEqual([]);
  });

  it('une seule piste suffit, quelle qu’elle soit, sans instrumentale', () => {
    expect(tracksWithContent(song({ drumClips: [clip('beat')] }))).toEqual(['drums']);
    expect(tracksWithContent(song({ instrumentClips: { melody: [], bass: [clip('air')] } }))).toEqual(['bass']);
    expect(tracksWithContent(song({ hasTake: true }))).toEqual(['voice']);
    expect(tracksWithContent(song({ hasInstrumental: true }))).toEqual(['instrumental']);
  });

  it('liste toutes les pistes qui ont du son, dans l’ordre du studio', () => {
    const all = song({ drumClips: [clip('vide'), clip('beat')], instrumentClips: { melody: [clip('air')], bass: [clip('air')] }, hasInstrumental: true, hasTake: true });
    expect(tracksWithContent(all)).toEqual(['drums', 'melody', 'bass', 'instrumental', 'voice']);
  });
});
