import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { MicrophoneRecorder } from './microphone-recorder';
import { PatternTransport } from './pattern-transport';
import { StudioSessionService, VocalTake } from './studio-session.service';
import { VocalTrackId, effectiveTrackGains } from './track-mix';

const audio = {
  duration: 2, length: 2, numberOfChannels: 1, sampleRate: 44100,
  getChannelData: () => new Float32Array([0.1, -0.1]), copyFromChannel: vi.fn(), copyToChannel: vi.fn(),
} as AudioBuffer;

function fakeNode() {
  const param = () => ({ value: 0 });
  return {
    gain: param(), pan: param(), frequency: param(), Q: param(),
    threshold: param(), ratio: param(), knee: param(), attack: param(), release: param(), delayTime: param(),
    connect<T>(output: T): T {
      if (!output) throw new Error('Tranche audio absente');
      return output;
    },
  };
}

function mockOfflineContext() {
  const played: AudioBuffer[] = [];
  vi.stubGlobal('OfflineAudioContext', class {
    readonly sampleRate = 44100;
    readonly destination = fakeNode();
    createGain = fakeNode;
    createStereoPanner = fakeNode;
    createBiquadFilter = fakeNode;
    createDynamicsCompressor = fakeNode;
    createDelay = fakeNode;
    createConvolver = fakeNode;
    createBuffer() { return audio; }
    createBufferSource() {
      const source = { ...fakeNode(), buffer: audio, start: () => played.push(source.buffer) };
      return source;
    }
    async startRendering() { return audio; }
  });
  return played;
}

function take(id: string, trackId: VocalTrackId): VocalTake {
  return { id, trackId, name: id, blob: new Blob(), fileId: null, buffer: audio, url: `blob:${id}`, mimeType: 'audio/webm', startSeconds: 0, latencyMs: 0 };
}

describe('#64 · pistes vocales', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:nouvelle-prise');
    TestBed.configureTestingModule({
      providers: [
        StudioSessionService,
        { provide: AudioEngineService, useValue: {
          start: async () => ({ context: {}, master: {} }),
          suspend: async () => undefined,
          currentTime: () => 0,
          outputLatencySeconds: () => 0,
          decode: async () => audio,
        } },
      ],
    });
    session = TestBed.inject(StudioSessionService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function prepareThreeVoices(): [VocalTrackId, VocalTrackId, VocalTrackId] {
    const voices: [VocalTrackId, VocalTrackId, VocalTrackId] = ['voice', session.addVocalTrack()!, session.addVocalTrack()!];
    for (const [index, voice] of voices.entries()) {
      const id = `take-${index}`;
      session.restoreTake(take(id, voice), ['take-0', 'take-1', 'take-2']);
      session.selectTake(id);
    }
    return voices;
  }

  it('ajoute, renomme et retire une piste avec ses seules prises', () => {
    const [lead, backs, adlibs] = prepareThreeVoices();
    expect(session.vocalTracks().length).toBe(3);
    expect(session.renameVocalTrack(backs, '  Backs  ')).toBe(true);
    expect(session.renameVocalTrack(backs, '  ')).toBe(false);
    session.armVocalTrack(backs);
    expect(session.armedVocalTrack().name).toBe('Backs');
    expect(session.take()?.id).toBe('take-1');
    expect(session.removeVocalTrack(backs)).toBe(true);
    expect(session.vocalTracks().map(track => track.id)).toEqual([lead, adlibs]);
    expect(session.takes().map(take => take.id)).toEqual(['take-0', 'take-2']);
    expect(session.mixer()[backs]).toBeUndefined();
    expect(session.armedVocalTrack().id).toBe(lead);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:take-1');
  });

  it('enregistre sur la piste armée en programmant l’instrumentale et les autres voix', async () => {
    const play = vi.spyOn(PatternTransport.prototype, 'play').mockReturnValue(0);
    vi.spyOn(MicrophoneRecorder.prototype, 'open').mockResolvedValue(undefined);
    vi.spyOn(MicrophoneRecorder.prototype, 'record').mockImplementation(started => started());
    vi.spyOn(MicrophoneRecorder.prototype, 'stop').mockResolvedValue({
      blob: new Blob(['test'], { type: 'audio/webm' }), inputLatencySeconds: 0, mimeType: 'audio/webm',
    });
    const [lead, backs, adlibs] = prepareThreeVoices();
    session.setInstrumental({ name: 'Instru.wav', buffer: audio, fileId: null });
    session.armVocalTrack(backs);
    session.setTrack(backs, { solo: true });
    await session.startRecording();
    expect(session.micState()).toBe('recording');
    expect(play.mock.calls[0][0].clips.map(clip => clip.track)).toEqual(['instrumental', lead, adlibs]);
    expect(effectiveTrackGains(play.mock.calls[0][0].mixer)[lead]).toBeGreaterThan(0);
    session.armVocalTrack(adlibs);
    await session.stopRecording();
    expect(session.lastRecordedTake()?.trackId).toBe(backs);
    expect(session.activeTakeFor(backs)?.id).toBe(session.lastRecordedTake()?.id);
    expect(session.activeTakeFor(lead)?.id).toBe('take-0');
  });

  it('exporte les trois voix avec leur réglage, y compris une version corrigée', async () => {
    const [lead, backs, adlibs] = prepareThreeVoices();
    session.setTrack(backs, { volumeDb: -6, pan: 0.5, delay: { enabled: true, amount: 0.3 } });
    session.setTrack(adlibs, { muted: true });
    const corrected = { ...audio, duration: 3 } as AudioBuffer;
    session.setCorrectedTake({ takeId: 'take-1', buffer: corrected, styleLabel: 'Trap' });
    session.setUseCorrectedTake(true, backs);
    session.drumClips.set([]);
    const played = mockOfflineContext();

    const exported = await session.renderWav();
    expect(exported?.wav.type).toBe('audio/wav');
    expect(played).toEqual([audio, corrected, audio]);
    expect(session.mixer()[backs]).toMatchObject({ volumeDb: -6, pan: 0.5, delay: { enabled: true, amount: 0.3 } });
    expect(effectiveTrackGains(session.mixer())[adlibs]).toBe(0);
    expect(effectiveTrackGains(session.mixer())[lead]).toBe(1);
  });
});
