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
    expect(nextPatternName([{ id: 'a', name: 'Pattern 01', steps: createEmptyPattern() }, { id: 'b', name: 'Refrain', steps: createEmptyPattern() }, { id: 'c', name: 'Pattern 07', steps: createEmptyPattern() }])).toBe('Pattern 08');
  });
});
