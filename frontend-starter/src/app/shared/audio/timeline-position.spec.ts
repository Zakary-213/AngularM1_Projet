import { describe, expect, it } from 'vitest';
import { MAX_SONG_STEPS, clampSongStep, describePosition, loopStepRange, stepAfterKey, stepFromFraction, validateLoopBars } from './timeline-position';
import { collectDueSteps } from './step-scheduler';

describe('position sur la timeline', () => {
  it('convertit un clic en pas, calé sur le temps le plus proche', () => {
    expect(stepFromFraction(0, 16)).toBe(0);
    expect(stepFromFraction(0.5, 16)).toBe(128); // milieu de 16 mesures = mesure 9
    expect(stepFromFraction(0.51, 16)).toBe(132); // arrondi au temps suivant
    expect(stepFromFraction(1.4, 8)).toBe(128); // clic hors de la piste : borné
  });

  it('déplace la position au clavier', () => {
    expect(stepAfterKey(16, 'ArrowRight', 64)).toBe(20);
    expect(stepAfterKey(16, 'ArrowLeft', 64)).toBe(12);
    expect(stepAfterKey(2, 'ArrowLeft', 64)).toBe(0);
    expect(stepAfterKey(16, 'PageUp', 64)).toBe(32);
    expect(stepAfterKey(16, 'PageDown', 64)).toBe(0);
    expect(stepAfterKey(40, 'Home', 64)).toBe(0);
    expect(stepAfterKey(0, 'End', 64)).toBe(64);
    expect(stepAfterKey(0, 'Enter', 64)).toBeNull();
  });

  it('borne la position au morceau', () => {
    expect(clampSongStep(-3)).toBe(0);
    expect(clampSongStep(Number.NaN)).toBe(0);
    expect(clampSongStep(1e9)).toBe(MAX_SONG_STEPS);
  });

  it('décrit la position en mesure et temps', () => {
    expect(describePosition(0)).toBe('mesure 1, temps 1');
    expect(describePosition(16 * 2 + 4 * 3)).toBe('mesure 3, temps 4');
  });
});

describe('plage de boucle', () => {
  it('convertit des mesures saisies (bornes incluses) en pas', () => {
    expect(loopStepRange({ fromBar: 1, toBar: 4 })).toEqual({ startStep: 0, endStep: 64 });
    expect(loopStepRange({ fromBar: 3, toBar: 3 })).toEqual({ startStep: 32, endStep: 48 });
  });

  it('refuse une plage inversée, hors morceau ou non entière', () => {
    expect(validateLoopBars({ fromBar: 1, toBar: 4 })).toBeNull();
    expect(validateLoopBars({ fromBar: 5, toBar: 4 })).toContain('suivre');
    expect(validateLoopBars({ fromBar: 0, toBar: 4 })).toContain('1 à');
    expect(validateLoopBars({ fromBar: 1, toBar: 999 })).toContain('1 à');
    expect(validateLoopBars({ fromBar: 1.5, toBar: 4 })).toContain('entiers');
  });

  it('le séquenceur revient au début de la boucle sans interrompre l’horloge', () => {
    // Boucle d'une mesure (pas 16 à 31) à 120 BPM : un pas = 0,125 s.
    const { due, next } = collectDueSteps({ step: 14, songStep: 30, time: 10 }, 10.3, 120, { startStep: 16, endStep: 32 });
    expect(due.map(cursor => [cursor.songStep, cursor.time, cursor.wrapped ?? false])).toEqual([
      [30, 10, false],
      [31, 10.125, false],
      [16, 10.25, true],
    ]);
    expect(next).toMatchObject({ songStep: 17, step: 1, time: 10.375 });
  });

  it('sans boucle, le morceau continue', () => {
    const { due } = collectDueSteps({ step: 15, songStep: 31, time: 0 }, 0.2, 120, null);
    expect(due.map(cursor => cursor.songStep)).toEqual([31, 32]);
  });
});
