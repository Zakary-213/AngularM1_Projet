import { describe, expect, it } from 'vitest';
import { CLIP_HOLD_MS, isClipHeld, meterFraction, nextClipTime, peakOf } from './level-meter';
import { MIXER_DELAY_DIVISION } from './mixer-graph';
import { tempoDelayMs } from './pitch/voice-fx';
import {
  DEFAULT_MASTER_VOLUME,
  MIN_MASTER_DB,
  clampMasterVolume,
  clampPan,
  createDefaultMixer,
  masterDbToVolume,
  masterVolumeToDb,
  sanitizeTrackMix,
  sendGain,
  updateTrack,
} from './track-mix';

describe('M7 · réglages du mixeur', () => {
  it('borne le panoramique entre gauche et droite, centre par défaut', () => {
    expect(clampPan(-3)).toBe(-1);
    expect(clampPan(2)).toBe(1);
    expect(clampPan(0.25)).toBe(0.25);
    expect(clampPan(Number.NaN)).toBe(0);
  });

  it('un envoi d’effet désactivé ne transmet rien, même avec une quantité réglée', () => {
    expect(sendGain({ enabled: false, amount: 0.8 })).toBe(0);
    expect(sendGain({ enabled: true, amount: 0.8 })).toBe(0.8);
  });

  it('nouvelle piste : mix neutre (0 dB, centre, égaliseur à plat, effets coupés)', () => {
    const mix = createDefaultMixer().voice;
    expect(mix).toMatchObject({ volumeDb: 0, pan: 0, muted: false, solo: false, eq: { lowDb: 0, midDb: 0, highDb: 0 } });
    expect(mix.reverb.enabled).toBe(false);
    expect(mix.delay.enabled).toBe(false);
  });

  it('updateTrack borne chaque réglage modifié et ne touche pas aux autres pistes', () => {
    const mixer = updateTrack(createDefaultMixer(), 'bass', { pan: -9, volumeDb: 99, eq: { lowDb: 30, midDb: 0, highDb: 0 }, reverb: { enabled: true, amount: 5 } });
    expect(mixer.bass).toMatchObject({ pan: -1, volumeDb: 6, eq: { lowDb: 12 }, reverb: { enabled: true, amount: 1 } });
    expect(mixer.drums).toEqual(createDefaultMixer().drums);
  });

  it('relit des réglages incomplets ou invalides avec des valeurs neutres', () => {
    expect(sanitizeTrackMix({})).toEqual(createDefaultMixer().drums);
    expect(sanitizeTrackMix({ muted: 'oui' as never, solo: 1 as never }).muted).toBe(false);
  });

  it('Master : volume linéaire borné, affiché en dB et reconverti sans dérive', () => {
    expect(clampMasterVolume(2)).toBe(1);
    expect(clampMasterVolume(-1)).toBe(0);
    expect(clampMasterVolume(Number.NaN)).toBe(DEFAULT_MASTER_VOLUME);
    expect(masterVolumeToDb(1)).toBe(0);
    expect(masterVolumeToDb(0)).toBe(MIN_MASTER_DB);
    expect(masterDbToVolume(masterVolumeToDb(DEFAULT_MASTER_VOLUME))).toBeCloseTo(DEFAULT_MASTER_VOLUME, 4);
    expect(masterDbToVolume(-6)).toBeCloseTo(0.5012, 4);
    expect(masterDbToVolume(12)).toBe(1);
  });

  it('le delay du mixeur suit le tempo en croche pointée', () => {
    expect(tempoDelayMs(90, MIXER_DELAY_DIVISION)).toBe(500);
    expect(tempoDelayMs(120, MIXER_DELAY_DIVISION)).toBe(375);
  });
});

describe('M7 · vumètres', () => {
  it('mesure la crête absolue d’un bloc', () => {
    expect(peakOf(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 6);
    expect(peakOf(new Float32Array(0))).toBe(0);
  });

  it('place la barre sur une échelle en dB de -48 à 0 dBFS', () => {
    expect(meterFraction(0)).toBe(0);
    expect(meterFraction(1)).toBe(1);
    expect(meterFraction(2)).toBe(1);
    expect(meterFraction(Math.pow(10, -24 / 20))).toBeCloseTo(0.5, 6);
    expect(meterFraction(Math.pow(10, -60 / 20))).toBe(0);
  });

  it('signale une saturation à 0 dBFS et la maintient un moment', () => {
    let lastClip = nextClipTime(null, 0.9, 1000);
    expect(isClipHeld(lastClip, 1000)).toBe(false);
    lastClip = nextClipTime(lastClip, 1.2, 2000);
    expect(isClipHeld(lastClip, 2000 + CLIP_HOLD_MS - 1)).toBe(true);
    lastClip = nextClipTime(lastClip, 0.5, 2500);
    expect(isClipHeld(lastClip, 2000 + CLIP_HOLD_MS)).toBe(false);
  });
});
