import { describe, expect, it } from 'vitest';
import { clampEq, eqFilterSpecs, isFlatEq, MAX_BAND_DB } from './three-band-eq';
import { computePeaks } from './waveform';

describe('égaliseur 3 bandes', () => {
  it('produit un plateau grave, une cloche médium et un plateau aigu', () => {
    expect(eqFilterSpecs({ lowDb: 4, midDb: -3, highDb: 2 })).toEqual([
      { type: 'lowshelf', frequency: 200, gain: 4 },
      { type: 'peaking', frequency: 1000, gain: -3, Q: 0.8 },
      { type: 'highshelf', frequency: 4000, gain: 2 },
    ]);
  });

  it('borne chaque bande à ±12 dB et neutralise les valeurs non numériques', () => {
    expect(clampEq({ lowDb: 40, midDb: -40, highDb: Number.NaN })).toEqual({ lowDb: MAX_BAND_DB, midDb: -MAX_BAND_DB, highDb: 0 });
    expect(clampEq({ midDb: 5 })).toEqual({ lowDb: 0, midDb: 5, highDb: 0 });
  });

  it('reconnaît un égaliseur à plat', () => {
    expect(isFlatEq({ lowDb: 0, midDb: 0, highDb: 0 })).toBe(true);
    expect(isFlatEq({ lowDb: 0, midDb: 1, highDb: 0 })).toBe(false);
  });
});

describe('forme d’onde', () => {
  it('donne le minimum et le maximum de chaque colonne, tous canaux confondus', () => {
    const left = Float32Array.from([0.1, -0.5, 0.2, 0.9]);
    const right = Float32Array.from([-0.8, 0.3, 0, -0.1]);
    const { min, max } = computePeaks([left, right], 2);
    expect(Array.from(min)).toEqual([Math.fround(-0.8), Math.fround(-0.1)]);
    expect(Array.from(max)).toEqual([Math.fround(0.3), Math.fround(0.9)]);
  });

  it('gère plus de colonnes que d’échantillons et un fichier vide', () => {
    expect(computePeaks([Float32Array.from([0.5])], 4).max.length).toBe(4);
    expect(Array.from(computePeaks([new Float32Array(0)], 3).max)).toEqual([0, 0, 0]);
  });
});
