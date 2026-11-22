import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngineService } from './audio-engine.service';
import { MAX_TAKES, StudioSessionService, VocalTake } from './studio-session.service';

function take(id: string, name = id): VocalTake {
  return {
    id,
    name,
    blob: new Blob(['x']),
    fileId: null,
    buffer: { duration: 5 } as AudioBuffer,
    url: `blob:${id}`,
    mimeType: 'audio/webm',
    startSeconds: 0,
    latencyMs: 0,
  };
}

describe('StudioSessionService — prises', () => {
  let session: StudioSessionService;

  beforeEach(() => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [StudioSessionService, { provide: AudioEngineService, useValue: { suspend: async () => undefined, currentTime: () => 0 } }],
    });
    session = TestBed.inject(StudioSessionService);
  });

  it('restaure les prises dans l’ordre du projet, quel que soit l’ordre d’arrivée', () => {
    const order = ['a', 'b', 'c'];
    session.restoreTake(take('c'), order);
    session.restoreTake(take('a'), order);
    session.restoreTake(take('b'), order);
    expect(session.takes().map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('la prise active est celle jouée ; en changer efface la correction de l’ancienne', () => {
    session.clearTakes('a');
    session.restoreTake(take('a'), ['a', 'b']);
    session.restoreTake(take('b'), ['a', 'b']);
    expect(session.take()?.id).toBe('a');
    session.correctedTake.set({ takeId: 'a', buffer: {} as AudioBuffer, styleLabel: 'Trap' });
    session.useCorrectedTake.set(true);
    session.selectTake('b');
    expect(session.take()?.id).toBe('b');
    expect(session.correctedTake()).toBeNull();
    expect(session.useCorrectedTake()).toBe(false);
  });

  it('renomme une prise avec un nom valide seulement', () => {
    session.restoreTake(take('a', 'Prise 1'), ['a']);
    expect(session.renameTake('a', '  Couplet 1  ')).toBe(true);
    expect(session.takes()[0].name).toBe('Couplet 1');
    expect(session.renameTake('a', '   ')).toBe(false);
    expect(session.renameTake('a', 'x'.repeat(41))).toBe(false);
    expect(session.takes()[0].name).toBe('Couplet 1');
  });

  it('supprimer la prise active active la précédente et libère son ObjectURL', () => {
    const order = ['a', 'b', 'c'];
    order.forEach(id => session.restoreTake(take(id), order));
    session.selectTake('b');
    session.removeTake('b');
    expect(session.takes().map(t => t.id)).toEqual(['a', 'c']);
    expect(session.activeTakeId()).toBe('a');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:b');
    session.removeTake('a');
    expect(session.activeTakeId()).toBe('c');
    session.removeTake('c');
    expect(session.activeTakeId()).toBeNull();
  });

  it(`refuse une nouvelle prise au-delà de ${MAX_TAKES}`, async () => {
    const order = Array.from({ length: MAX_TAKES }, (_, i) => `t${i}`);
    order.forEach(id => session.restoreTake(take(id), order));
    expect(session.canRecordTake()).toBe(false);
    await session.startRecording();
    expect(session.micState()).toBe('idle');
    expect(session.micError()).toContain(`${MAX_TAKES} prises maximum`);
  });

  it('associe une prise à son fichier envoyé', () => {
    session.restoreTake(take('a'), ['a']);
    session.markTakeUploaded('a', 'file-1');
    expect(session.takes()[0].fileId).toBe('file-1');
  });

  it('décale une prise par pas, borné à une seconde autour de la position enregistrée', () => {
    session.restoreTake({ ...take('a'), startSeconds: -0.08 }, ['a']);
    expect(session.shiftTake('a', 0.01)).toBeCloseTo(-0.07, 9);
    expect(session.shiftTake('a', -0.03)).toBeCloseTo(-0.1, 9);
    expect(session.shiftTake('a', 5)).toBeCloseTo(0.92, 9);
    expect(session.shiftTake('a', -9)).toBeCloseTo(-1.08, 9);
    expect(session.shiftTake('inconnue', 0.01)).toBeNull();
  });
});
