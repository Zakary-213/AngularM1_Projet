import { describe, expect, it } from 'vitest';
import { createDemoPattern, createEmptyPattern, cycleStep, hitsAtStep, nextPatternName, setStepVelocity, shiftRow, velocityLabel } from './drum-pattern';

describe('patterns avec vélocité (M3)', () => {
  it('un clic fait passer une case de vide à forte, moyenne, douce puis vide', () => {
    let pattern = createEmptyPattern();
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      pattern = cycleStep(pattern, 'kick', 3);
      values.push(pattern.kick[3]);
    }
    expect(values).toEqual([1, 0.7, 0.4, 0]);
  });

  it('borne la vélocité entre 0 et 1', () => {
    expect(setStepVelocity(createEmptyPattern(), 'snare', 0, 3).snare[0]).toBe(1);
    expect(setStepVelocity(createEmptyPattern(), 'snare', 0, -1).snare[0]).toBe(0);
    expect(() => setStepVelocity(createEmptyPattern(), 'snare', 16, 1)).toThrow(RangeError);
  });

  it('décale les frappes d’une ligne en boucle sur la mesure', () => {
    const pattern = setStepVelocity(setStepVelocity(createEmptyPattern(), 'kick', 0, 1), 'kick', 15, 0.4);
    const later = shiftRow(pattern, 'kick', 1);
    expect(later.kick[1]).toBe(1);
    expect(later.kick[0]).toBe(0.4); // le pas 16 revient au début
    expect(shiftRow(later, 'kick', -1)).toEqual(pattern);
    expect(later.snare).toEqual(pattern.snare);
  });

  it('donne les frappes d’un pas avec leur force', () => {
    expect(hitsAtStep(createDemoPattern(), 2)).toEqual([{ voice: 'hihat', velocity: 0.4 }]);
    expect(hitsAtStep(createDemoPattern(), 16)).toEqual([{ voice: 'kick', velocity: 1 }, { voice: 'hihat', velocity: 1 }]);
  });

  it('nomme les niveaux et numérote les nouveaux patterns', () => {
    expect([1, 0.7, 0.4, 0.55].map(velocityLabel)).toEqual(['fort', 'moyen', 'doux', 'moyen']);
    expect(nextPatternName([])).toBe('Pattern 01');
    const entry = (id: string, name: string) => ({ id, name, steps: createEmptyPattern(), kit: 'boomBap' as const });
    expect(nextPatternName([entry('a', 'Pattern 01'), entry('b', 'Refrain'), entry('c', 'Pattern 07')])).toBe('Pattern 08');
  });

  it('M3 : six instruments, dont clap, percussion et 808', () => {
    expect(Object.keys(createEmptyPattern())).toEqual(['kick', 'snare', 'clap', 'hihat', 'perc', 'bass808']);
    expect(createDemoPattern().bass808.every(velocity => velocity === 0)).toBe(true);
  });
});
