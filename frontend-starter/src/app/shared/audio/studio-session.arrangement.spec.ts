import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { StudioSessionService, VocalTake } from './studio-session.service';

describe('StudioSessionService — arrangement et annulation', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StudioSessionService, { provide: AudioEngineService, useValue: { suspend: async () => undefined, currentTime: () => 0 } }],
    });
    session = TestBed.inject(StudioSessionService);
    session.loadArrangement([{ id: 'intro', startBar: 0, lengthBars: 4, patternId: 'pattern-1' }], 0);
  });

  it('chaque modification est annulable puis rétablissable', () => {
    expect(session.canUndo()).toBe(false);
    session.moveDrumClip('intro', 2);
    session.resizeDrumClip('intro', 4);
    expect(session.drumClips()).toEqual([{ id: 'intro', startBar: 2, lengthBars: 8, patternId: 'pattern-1' }]);
    session.undo();
    expect(session.drumClips()).toEqual([{ id: 'intro', startBar: 2, lengthBars: 4, patternId: 'pattern-1' }]);
    session.undo();
    expect(session.drumClips()).toEqual([{ id: 'intro', startBar: 0, lengthBars: 4, patternId: 'pattern-1' }]);
    expect(session.canUndo()).toBe(false);
    session.redo();
    expect(session.drumClips()[0].startBar).toBe(2);
    expect(session.canRedo()).toBe(true);
  });

  it('dupliquer, ajouter et supprimer passent aussi par l’historique', () => {
    const copy = session.duplicateDrumClip('intro')!;
    expect(session.drumClips().map(clip => [clip.startBar, clip.lengthBars])).toEqual([[0, 4], [4, 4]]);
    session.removeDrumClip(copy);
    session.seek(32);
    const added = session.addDrumClipAtPlayhead();
    expect(session.drumClips().find(clip => clip.id === added)?.startBar).toBe(2);
    session.undo();
    session.undo();
    expect(session.drumClips().map(clip => clip.id)).toEqual(['intro', copy]);
  });

  it('une modification sans effet (borne atteinte) n’ajoute rien à l’historique', () => {
    session.moveDrumClip('intro', -3);
    expect(session.canUndo()).toBe(false);
    session.moveInstrumental(-4);
    expect(session.canUndo()).toBe(false);
  });

  it('déplace l’instrumentale par temps ; sa position en secondes suit le tempo', () => {
    session.moveInstrumental(8);
    session.setBpm(120);
    expect(session.instrumentalStartBeat()).toBe(8);
    expect(session.instrumentalStartSeconds()).toBe(4);
    session.undo();
    expect(session.instrumentalStartBeat()).toBe(0);
  });

  it('déplace une prise et restaure sa position à l’annulation', () => {
    const take: VocalTake = {
      id: 't1', name: 'Prise 1', blob: new Blob(), fileId: null, buffer: { duration: 5 } as AudioBuffer,
      url: 'blob:t1', mimeType: 'audio/webm', startSeconds: 1, latencyMs: 0,
    };
    session.restoreTake(take, ['t1']);
    session.setBpm(120);
    session.moveTake('t1', 4); // 4 temps à 120 BPM = 2 s
    expect(session.takes()[0].startSeconds).toBe(3);
    session.shiftTake('t1', 0.01);
    expect(session.takes()[0].startSeconds).toBeCloseTo(3.01, 9);
    session.undo();
    session.undo();
    expect(session.takes()[0].startSeconds).toBe(1);
  });

  it('ouvrir un projet vide l’historique', () => {
    session.moveDrumClip('intro', 1);
    session.loadArrangement([], 0);
    expect(session.canUndo()).toBe(false);
    expect(session.drumClips()).toEqual([]);
  });
});
