import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRUM_CLIPS,
  DrumClip,
  MAX_DRUM_CLIP_BARS,
  UndoHistory,
  addDrumClip,
  drumClipsEndBar,
  duplicateDrumClip,
  isDrumBarActive,
  moveDrumClip,
  removeDrumClip,
  resizeDrumClip,
} from './arrangement';
import { MAX_SONG_BARS } from './timeline-position';

const intro: DrumClip = { id: 'a', startBar: 0, lengthBars: 4 };
const chorus: DrumClip = { id: 'b', startBar: 8, lengthBars: 8 };

describe('clips de batterie', () => {
  it('la batterie joue seulement à l’intérieur des clips', () => {
    expect(isDrumBarActive([intro, chorus], 3)).toBe(true);
    expect(isDrumBarActive([intro, chorus], 4)).toBe(false);
    expect(isDrumBarActive([intro, chorus], 15)).toBe(true);
    expect(isDrumBarActive([], 0)).toBe(false);
    expect(drumClipsEndBar([intro, chorus])).toBe(16);
  });

  it('déplace un clip, sans sortir du morceau, et garde l’ordre', () => {
    expect(moveDrumClip([intro, chorus], 'a', 10).map(c => [c.id, c.startBar])).toEqual([['b', 8], ['a', 10]]);
    expect(moveDrumClip([intro], 'a', -5)[0].startBar).toBe(0);
    expect(moveDrumClip([intro], 'a', 999)[0].startBar).toBe(MAX_SONG_BARS - 4);
  });

  it('raccourcit et allonge un clip par la fin, entre 1 et 32 mesures', () => {
    expect(resizeDrumClip([intro], 'a', -2)[0].lengthBars).toBe(2);
    expect(resizeDrumClip([intro], 'a', -10)[0].lengthBars).toBe(1);
    expect(resizeDrumClip([intro], 'a', 100)[0].lengthBars).toBe(MAX_DRUM_CLIP_BARS);
  });

  it('duplique un clip juste après l’original', () => {
    expect(duplicateDrumClip([intro], 'a', 'c')).toEqual([intro, { id: 'c', startBar: 4, lengthBars: 4 }]);
    expect(duplicateDrumClip([{ id: 'z', startBar: MAX_SONG_BARS - 4, lengthBars: 4 }], 'z', 'c')).toBeNull();
    expect(duplicateDrumClip([intro], 'inconnu', 'c')).toBeNull();
  });

  it('ajoute et supprime des clips', () => {
    expect(addDrumClip([], 6, 'n')).toEqual([{ id: 'n', startBar: 6, lengthBars: 4 }]);
    expect(removeDrumClip([intro, chorus], 'a')).toEqual([chorus]);
    expect(DEFAULT_DRUM_CLIPS).toEqual([{ id: 'drums-1', startBar: 0, lengthBars: 8 }]);
  });
});

describe('annuler / rétablir', () => {
  it('annule puis rétablit dans l’ordre', () => {
    const history = new UndoHistory<number>();
    history.record(1); // passage de 1 à 2
    history.record(2); // passage de 2 à 3
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBeNull();
    expect(history.redo(1)).toBe(2);
    expect(history.canRedo).toBe(true);
  });

  it('une nouvelle modification efface ce qui pouvait être rétabli', () => {
    const history = new UndoHistory<number>();
    history.record(1);
    history.undo(2);
    history.record(1);
    expect(history.canRedo).toBe(false);
  });

  it('garde au plus `limit` états', () => {
    const history = new UndoHistory<number>(3);
    [1, 2, 3, 4, 5].forEach(value => history.record(value));
    expect(history.undo(6)).toBe(5);
    expect(history.undo(5)).toBe(4);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBeNull();
  });
});

import { dragUnits, layoutClip } from './timeline-layout';

describe('placement des clips sur la timeline', () => {
  it('place un clip en % de la fenêtre visible', () => {
    expect(layoutClip(10, 20, 100)).toEqual({ left: 10, width: 20 });
    expect(layoutClip(90, 30, 100)).toEqual({ left: 90, width: 10 }); // coupé à droite
    expect(layoutClip(-2, 10, 100)).toEqual({ left: 0, width: 8 }); // prise commencée avant le morceau
  });

  it('masque un clip hors de la fenêtre et garde une largeur cliquable', () => {
    expect(layoutClip(120, 10, 100)).toBeNull();
    expect(layoutClip(-10, 5, 100)).toBeNull();
    expect(layoutClip(0, 0.01, 100)?.width).toBe(1);
  });

  it('convertit un glissement en mesures ou en temps', () => {
    // Piste de 800 px montrant 16 mesures : 50 px par mesure.
    expect(dragUnits(120, 800, 16)).toBe(2);
    expect(dragUnits(-30, 800, 16)).toBe(-1);
    expect(dragUnits(10, 800, 16)).toBe(0);
    expect(dragUnits(10, 0, 16)).toBe(0);
  });
});
