import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES, validateAudioFile } from './audio-file';
import { createDemoPattern, toggleStep, voicesAtStep } from './drum-pattern';
import { clipPlacement, gainToDecibels } from './mix-graph';
import { describeMicrophoneError, pickRecordingMimeType, takeStartSeconds } from './microphone-recorder';

describe('pattern de batterie', () => {
  it('active puis désactive une frappe sans modifier le pattern d’origine', () => {
    const original = createDemoPattern();
    const toggled = toggleStep(original, 'snare', 0);
    expect(toggled.snare[0]).toBe(true);
    expect(original.snare[0]).toBe(false);
    expect(toggleStep(toggled, 'snare', 0).snare[0]).toBe(false);
  });

  it('refuse un pas hors de la mesure', () => {
    expect(() => toggleStep(createDemoPattern(), 'kick', 16)).toThrow(RangeError);
    expect(() => toggleStep(createDemoPattern(), 'kick', -1)).toThrow(RangeError);
  });

  it('liste les instruments d’un pas, y compris sur les mesures répétées', () => {
    expect(voicesAtStep(createDemoPattern(), 0)).toEqual(['kick', 'hihat']);
    expect(voicesAtStep(createDemoPattern(), 16 + 4)).toEqual(['snare', 'hihat']);
  });
});

describe('placement des clips', () => {
  it('décale un clip qui commence après le début du morceau', () => {
    expect(clipPlacement(10, 2)).toEqual({ when: 12, offset: 0 });
  });

  it('saute le début d’un clip qui commence avant le morceau', () => {
    expect(clipPlacement(10, -0.25)).toEqual({ when: 10, offset: 0.25 });
  });

  it('positionne une prise en compensant la latence aller-retour', () => {
    expect(takeStartSeconds(5.3, 5.1, 0.05)).toBeCloseTo(0.15);
    expect(takeStartSeconds(5.1, 5.1, 0.04)).toBeCloseTo(-0.04);
  });

  it('convertit un gain linéaire en dBFS', () => {
    expect(gainToDecibels(1)).toBe(0);
    expect(gainToDecibels(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDecibels(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('import de fichier audio', () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it('accepte MP3 et WAV, y compris sans type MIME', () => {
    expect(validateAudioFile(file('beat.mp3', 'audio/mpeg'))).toBeNull();
    expect(validateAudioFile(file('beat.wav', 'audio/wav'))).toBeNull();
    expect(validateAudioFile(file('BEAT.WAV', ''))).toBeNull();
  });

  it('refuse les fichiers vides, trop lourds ou d’un autre format', () => {
    expect(validateAudioFile(file('beat.mp3', 'audio/mpeg', 0))).toContain('vide');
    expect(validateAudioFile(file('beat.mp3', 'audio/mpeg', MAX_IMPORT_BYTES + 1))).toContain('25 Mo');
    expect(validateAudioFile(file('photo.png', 'image/png'))).toContain('MP3 ou WAV');
  });
});

describe('microphone', () => {
  it('choisit le premier format d’enregistrement pris en charge', () => {
    expect(pickRecordingMimeType(type => type === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingMimeType(() => false)).toBeNull();
  });

  it('explique les erreurs d’accès au micro', () => {
    expect(describeMicrophoneError(new DOMException('x', 'NotAllowedError'))).toContain('refusé');
    expect(describeMicrophoneError(new DOMException('x', 'NotFoundError'))).toContain('Aucun micro');
    expect(describeMicrophoneError(new DOMException('x', 'NotReadableError'))).toContain('indisponible');
    expect(describeMicrophoneError('inconnu')).toContain('Impossible');
  });
});
