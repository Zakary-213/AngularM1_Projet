import { describe, expect, it } from 'vitest';
import { encodeWav, peakLevel } from './wav-encoder';

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)));
}

describe('encodeWav', () => {
  it('écrit un en-tête PCM 16 bits stéréo valide', () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([1, -1, 0]);
    const view = new DataView(encodeWav([left, right], 44100));

    expect(view.byteLength).toBe(44 + 3 * 2 * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('entrelace les canaux et écrête les valeurs hors bornes', () => {
    const view = new DataView(encodeWav([new Float32Array([1.5, -2]), new Float32Array([0, 0.5])], 8000));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(16383);
  });

  it('refuse des canaux absents ou de longueurs différentes', () => {
    expect(() => encodeWav([], 44100)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100)).toThrow(RangeError);
  });
});

describe('peakLevel', () => {
  it('renvoie la crête absolue de tous les canaux', () => {
    expect(peakLevel([new Float32Array([0.2, -0.9]), new Float32Array([0.4])])).toBeCloseTo(0.9);
    expect(peakLevel([new Float32Array(4)])).toBe(0);
  });
});
