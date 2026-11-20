import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { StudioSessionService } from './studio-session.service';

describe('StudioSessionService — position et boucle', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StudioSessionService, { provide: AudioEngineService, useValue: { suspend: async () => undefined, currentTime: () => 0 } }],
    });
    session = TestBed.inject(StudioSessionService);
  });

  it('à l’arrêt, se placer garde la position pour la prochaine lecture', async () => {
    await session.seek(36);
    expect(session.songStep()).toBe(36);
    expect(session.transportState()).toBe('paused');
    expect(session.position()).toEqual({ bar: 3, beat: 2, sixteenth: 1 });
    session.stopPlayback();
    expect(session.songStep()).toBe(0);
  });

  it('ignore le placement pendant une prise', async () => {
    session.micState.set('recording');
    await session.seek(64);
    expect(session.songStep()).toBe(0);
  });

  it('boucle active seulement avec une plage valide', async () => {
    expect(session.loopRange()).toBeNull();
    await session.setLoop({ enabled: true, bars: { fromBar: 2, toBar: 3 } });
    expect(session.loopRange()).toEqual({ startStep: 16, endStep: 48 });
    await session.setLoop({ bars: { fromBar: 4, toBar: 2 } });
    expect(session.loopRange()).toBeNull();
    await session.setLoop({ enabled: false, bars: { fromBar: 1, toBar: 4 } });
    expect(session.loopRange()).toBeNull();
  });

  it('la fin du morceau couvre au moins 4 mesures', () => {
    expect(session.songEndStep()).toBe(64);
  });
});
