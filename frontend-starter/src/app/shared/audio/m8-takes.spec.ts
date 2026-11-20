import { describe, expect, it } from 'vitest';
import { recordingFileFormat, toInputDevices } from './microphone-recorder';
import { rmsLevel } from './wav-encoder';

describe('prises vocales : outils', () => {
  it('liste uniquement les entrées audio, avec un nom générique avant autorisation', () => {
    const devices = [
      { kind: 'audioinput', deviceId: 'a', label: 'Micro USB' },
      { kind: 'audiooutput', deviceId: 'b', label: 'Casque' },
      { kind: 'audioinput', deviceId: 'c', label: '' },
      { kind: 'audioinput', deviceId: '', label: '' },
    ] as MediaDeviceInfo[];
    expect(toInputDevices(devices)).toEqual([
      { deviceId: 'a', label: 'Micro USB' },
      { deviceId: 'c', label: 'Micro 2' },
    ]);
  });

  it('donne le type sans paramètres et l’extension pour l’envoi au serveur', () => {
    expect(recordingFileFormat('audio/webm;codecs=opus')).toEqual({ type: 'audio/webm', extension: 'webm' });
    expect(recordingFileFormat('audio/ogg; codecs=opus')).toEqual({ type: 'audio/ogg', extension: 'ogg' });
    expect(recordingFileFormat('audio/mp4')).toEqual({ type: 'audio/mp4', extension: 'm4a' });
  });

  it('calcule le niveau efficace d’une trame', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsLevel(new Float32Array(8))).toBe(0);
  });
});
