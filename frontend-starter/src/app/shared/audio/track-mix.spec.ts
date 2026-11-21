import { describe, expect, it } from 'vitest';
import { clipPlacement } from './mix-graph';
import {
  MAX_TRACK_DB,
  MIN_TRACK_DB,
  clampTrackDb,
  createDefaultMixer,
  decibelsToGain,
  effectiveTrackGains,
  isTrackAudible,
  updateTrack,
} from './track-mix';

describe('mixage par piste', () => {
  it('laisse toutes les pistes à gain 1 par défaut', () => {
    expect(effectiveTrackGains(createDefaultMixer())).toEqual({ drums: 1, melody: 1, bass: 1, instrumental: 1, voice: 1 });
  });

  it('convertit les dB du fader en gain linéaire', () => {
    expect(decibelsToGain(0)).toBe(1);
    expect(decibelsToGain(-6)).toBeCloseTo(0.501, 3);
    expect(decibelsToGain(6)).toBeCloseTo(1.995, 3);
  });

  it('borne le volume du fader', () => {
    expect(clampTrackDb(-100)).toBe(MIN_TRACK_DB);
    expect(clampTrackDb(40)).toBe(MAX_TRACK_DB);
    expect(clampTrackDb(Number.NaN)).toBe(0);
  });

  it('coupe une piste muette sans toucher aux autres', () => {
    const mixer = updateTrack(createDefaultMixer(), 'instrumental', { muted: true });
    expect(effectiveTrackGains(mixer)).toEqual({ drums: 1, melody: 1, bass: 1, instrumental: 0, voice: 1 });
  });

  it('ne laisse entendre que les pistes en solo', () => {
    const mixer = updateTrack(updateTrack(createDefaultMixer(), 'voice', { solo: true }), 'drums', { solo: true, volumeDb: -6 });
    const gains = effectiveTrackGains(mixer);
    expect(gains.instrumental).toBe(0);
    expect(gains.voice).toBe(1);
    expect(gains.drums).toBeCloseTo(0.501, 3);
  });

  it('donne la priorité au mute sur le solo', () => {
    const mixer = updateTrack(createDefaultMixer(), 'voice', { solo: true, muted: true });
    expect(isTrackAudible(mixer, 'voice')).toBe(false);
    // Une piste muette en solo garde les autres coupées : le solo reste actif.
    expect(isTrackAudible(mixer, 'drums')).toBe(false);
  });

  it('ne modifie pas l’état d’origine', () => {
    const original = createDefaultMixer();
    updateTrack(original, 'drums', { muted: true });
    expect(original.drums.muted).toBe(false);
  });
});

describe('reprise après une pause', () => {
  it('saute la partie d’un clip déjà jouée', () => {
    // Reprise à 3 s d'un clip qui commence à 1 s : on lit à partir de 2 s dans le fichier.
    expect(clipPlacement(10, 1, 3)).toEqual({ when: 10, offset: 2 });
  });

  it('décale un clip qui commence après la position de reprise', () => {
    expect(clipPlacement(10, 5, 3)).toEqual({ when: 12, offset: 0 });
  });
});
