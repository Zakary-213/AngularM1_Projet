import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngineService } from '../audio/audio-engine.service';
import { StudioSessionService, VocalTake } from '../audio/studio-session.service';
import { MusicalProject, ProjectContent } from '../models/musical-project.model';
import { ProjectService } from './project.service';
import { TrackService } from './track.service';
import { Track } from '../models/track.model';
import { StudioProjectService } from './studio-project.service';

const stored: MusicalProject = {
  id: 'p1',
  ownerId: 'u1',
  formatVersion: 1,
  title: 'Minuit',
  origin: 'create',
  revision: 4,
  bpm: 132,
  key: { root: 0, scale: 'major' },
  tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', volumeDb: -9, clips: [] }],
  patterns: [],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
};

/** Faux AudioBuffer : seules la durée et les métadonnées sont lues par ces tests. */
function fakeBuffer(duration = 120): AudioBuffer {
  return { duration, length: duration * 100, sampleRate: 100, numberOfChannels: 1, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer;
}

const FILE_ID = '64b0000000000000000000aa';
const withInstrumental: MusicalProject = {
  ...stored,
  bpm: 90,
  tracks: [
    {
      id: 'instrumental',
      name: 'Instrumentale',
      type: 'audio',
      eq: { lowDb: 5, midDb: 0, highDb: -3 },
      clips: [{ id: 'clip-instrumental', startBeat: 0, durationBeats: 180, offsetSeconds: 0, audioFileId: FILE_ID, label: 'beat.mp3' }],
    },
  ],
};

describe('StudioProjectService', () => {
  let api: { get: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let tracksApi: { upload: ReturnType<typeof vi.fn>; audio: ReturnType<typeof vi.fn> };
  let engine: { decode: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn>; currentTime: () => number };
  let service: StudioProjectService;
  let session: StudioSessionService;

  beforeEach(() => {
    api = { get: vi.fn(() => of(stored)), save: vi.fn() };
    tracksApi = { upload: vi.fn(), audio: vi.fn(() => of(new Blob(['audio']))) };
    engine = { decode: vi.fn(async () => fakeBuffer()), suspend: vi.fn(async () => undefined), currentTime: () => 0 };
    TestBed.configureTestingModule({
      providers: [
        StudioSessionService,
        StudioProjectService,
        { provide: ProjectService, useValue: api },
        { provide: TrackService, useValue: tracksApi },
        { provide: AudioEngineService, useValue: engine },
      ],
    });
    service = TestBed.inject(StudioProjectService);
    session = TestBed.inject(StudioSessionService);
  });

  it('charge le projet dans le studio, sans modification en attente', () => {
    service.load('p1');
    expect(service.loadState()).toBe('loaded');
    expect(session.bpm()).toBe(132);
    expect(session.projectKey()).toEqual({ root: 0, scale: 'major' });
    expect(session.mixer().drums.volumeDb).toBe(-9);
    expect(service.saveState()).toBe('saved');
  });

  it('signale une modification puis la sauvegarde avec la révision ouverte', () => {
    service.load('p1');
    session.toggleStep('kick', 1);
    expect(service.saveState()).toBe('dirty');

    const response = new Subject<MusicalProject>();
    api.save.mockReturnValue(response);
    service.save();
    expect(service.saveState()).toBe('saving');
    const [id, revision, content] = api.save.mock.calls[0] as [string, number, ProjectContent];
    expect([id, revision]).toEqual(['p1', 4]);
    expect(content.patterns[0].drumRows.find(row => row.voice === 'kick')?.steps[1]).toBe(true);

    response.next({ ...stored, revision: 5 });
    expect(service.saveState()).toBe('saved');
    expect(service.project()?.revision).toBe(5);
  });

  it('une modification faite pendant la sauvegarde reste non sauvegardée', () => {
    service.load('p1');
    session.toggleStep('kick', 1);
    const response = new Subject<MusicalProject>();
    api.save.mockReturnValue(response);
    service.save();
    session.toggleStep('kick', 2);
    response.next({ ...stored, revision: 5 });
    expect(service.saveState()).toBe('dirty');
  });

  it('conflit 409 : bloque la sauvegarde sans rien écraser, puis recharge sur demande', () => {
    service.load('p1');
    session.toggleStep('kick', 1);
    api.save.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    service.save();
    expect(service.saveState()).toBe('conflict');
    service.save();
    expect(api.save).toHaveBeenCalledTimes(1);

    service.reload();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(service.saveState()).toBe('saved');
  });

  it('serveur injoignable : erreur affichée, modifications conservées', () => {
    service.load('p1');
    session.toggleStep('kick', 1);
    api.save.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    service.save();
    expect(service.saveState()).toBe('error');
    expect(service.saveError()).toContain('injoignable');
    expect(service.hasUnsavedChanges()).toBe(true);
  });

  it('refuse d’ouvrir un projet d’une version future du format', () => {
    api.get.mockReturnValue(of({ ...stored, formatVersion: 2 }));
    service.load('p1');
    expect(service.loadState()).toBe('error');
    expect(service.loadError()).toContain('version plus récente');
    expect(service.project()).toBeNull();
  });

  it('projet introuvable ou d’un autre utilisateur : message explicite', () => {
    api.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })) as Observable<MusicalProject>);
    service.load('p1');
    expect(service.loadError()).toBe('Projet introuvable ou non autorisé.');
  });

  describe('instrumentale (M6)', () => {
    const file = () => new File(['fake mp3'], 'beat.mp3', { type: 'audio/mpeg' });

    it('envoie le fichier avec la progression, puis le référence dans le projet à sauvegarder', async () => {
      service.load('p1');
      const events = new Subject<HttpEvent<Track>>();
      tracksApi.upload.mockReturnValue(events);
      await service.importInstrumental(file());

      expect(session.instrumental()?.name).toBe('beat.mp3');
      expect(tracksApi.upload).toHaveBeenCalledWith(expect.any(File), 'beat.mp3');
      events.next({ type: HttpEventType.UploadProgress, loaded: 40, total: 100 });
      expect(service.upload()).toEqual({ state: 'uploading', progress: 40 });
      expect(service.canSave()).toBe(false);

      events.next(new HttpResponse({ body: { id: FILE_ID } as Track }));
      expect(service.upload()).toEqual({ state: 'idle' });
      expect(session.instrumental()?.fileId).toBe(FILE_ID);
      expect(service.instrumentalRef()).toEqual({ fileId: FILE_ID, label: 'beat.mp3', durationBeats: 264 });
      expect(service.saveState()).toBe('dirty');

      api.save.mockReturnValue(of({ ...stored, revision: 5 }));
      service.save();
      const content = api.save.mock.calls[0][2] as ProjectContent;
      const clip = content.tracks.find(track => track.id === 'instrumental')!.clips[0];
      expect(clip.audioFileId).toBe(FILE_ID);
      expect(clip.label).toBe('beat.mp3');
    });

    it('échec d’envoi : message, instrumentale toujours écoutable, nouvel essai possible', async () => {
      service.load('p1');
      tracksApi.upload.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
      await service.importInstrumental(file());
      expect(service.upload()).toMatchObject({ state: 'error' });
      expect(session.instrumental()).not.toBeNull();
      expect(service.instrumentalRef()).toBeNull();

      tracksApi.upload.mockReturnValueOnce(of(new HttpResponse({ body: { id: FILE_ID } as Track })));
      service.retryUpload();
      expect(tracksApi.upload).toHaveBeenCalledTimes(2);
      expect(service.instrumentalRef()?.fileId).toBe(FILE_ID);
    });

    it('session libre : fichier seulement local, aucun envoi', async () => {
      await service.importInstrumental(file());
      expect(session.instrumental()?.fileId).toBeNull();
      expect(tracksApi.upload).not.toHaveBeenCalled();
    });

    it('à l’ouverture, récupère le fichier référencé et son égaliseur, sans modification en attente', async () => {
      api.get.mockReturnValue(of(withInstrumental));
      service.load('p1');
      expect(tracksApi.audio).toHaveBeenCalledWith(FILE_ID);
      await vi.waitFor(() => expect(session.instrumental()?.fileId).toBe(FILE_ID));
      expect(session.instrumental()?.name).toBe('beat.mp3');
      expect(session.mixer().instrumental.eq).toEqual({ lowDb: 5, midDb: 0, highDb: -3 });
      expect(service.saveState()).toBe('saved');
    });

    it('fichier supprimé de la bibliothèque : message explicite, référence conservée', () => {
      api.get.mockReturnValue(of(withInstrumental));
      tracksApi.audio.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      service.load('p1');
      expect(service.download()).toBe('error');
      expect(service.downloadError()).toContain('n’existe plus');
      expect(service.instrumentalRef()?.fileId).toBe(FILE_ID);
      expect(service.saveState()).toBe('saved');
    });

    it('retirer l’instrumentale la sort du projet (modification à sauvegarder)', async () => {
      api.get.mockReturnValue(of(withInstrumental));
      service.load('p1');
      await vi.waitFor(() => expect(session.instrumental()).not.toBeNull());
      service.removeInstrumental();
      expect(session.instrumental()).toBeNull();
      expect(service.instrumentalRef()).toBeNull();
      expect(service.saveState()).toBe('dirty');
    });
  });

  describe('prises vocales (M8)', () => {
    const TAKE_FILE = '64b0000000000000000000c1';
    const recorded = (id: string, name: string): VocalTake => ({
      id,
      name,
      blob: new Blob(['opus'], { type: 'audio/webm;codecs=opus' }),
      fileId: null,
      buffer: fakeBuffer(12),
      url: `blob:${id}`,
      mimeType: 'audio/webm;codecs=opus',
      startSeconds: -0.09,
      latencyMs: 40,
    });

    /** Simule la fin d'un enregistrement (le micro n'existe pas dans les tests). */
    function fakeRecording(take: VocalTake): void {
      vi.spyOn(session, 'stopRecording').mockImplementation(async () => {
        session.takes.update(takes => [...takes, take]);
        session.activeTakeId.set(take.id);
        session.lastRecordedTake.set(take);
      });
    }

    it('envoie la nouvelle prise en WebM puis la sauvegarde comme clip actif de la piste Voix', async () => {
      service.load('p1');
      tracksApi.upload.mockReturnValue(of(new HttpResponse({ body: { id: TAKE_FILE } as Track })));
      fakeRecording(recorded('take-1', 'Prise 1'));
      await service.stopRecording();

      const [file, title] = tracksApi.upload.mock.calls[0] as [File, string];
      expect(file.name).toBe('Prise 1.webm');
      expect(file.type).toBe('audio/webm');
      expect(title).toBe('Prise 1 · Minuit');
      expect(session.takes()[0].fileId).toBe(TAKE_FILE);
      expect(service.saveState()).toBe('dirty');

      expect(service.renameTake('take-1', 'Couplet')).toBe(true);
      service.shiftTake('take-1', 0.02);
      expect(service.takeRefs()[0].startSeconds).toBeCloseTo(-0.07, 9);
      api.save.mockReturnValue(of({ ...stored, revision: 5 }));
      service.save();
      const voice = (api.save.mock.calls[0][2] as ProjectContent).tracks.find(track => track.id === 'voice')!;
      expect(voice.activeClipId).toBe('take-1');
      expect(voice.clips[0]).toMatchObject({ id: 'take-1', label: 'Couplet', audioFileId: TAKE_FILE, startBeat: 0, offsetSeconds: 0.07 });
    });

    it('échec d’envoi d’une prise : message par prise et nouvel essai', async () => {
      service.load('p1');
      tracksApi.upload.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
      fakeRecording(recorded('take-1', 'Prise 1'));
      await service.stopRecording();
      expect(service.takeUploads()['take-1']).toMatchObject({ state: 'error' });
      expect(service.takeRefs()).toEqual([]);

      tracksApi.upload.mockReturnValueOnce(of(new HttpResponse({ body: { id: TAKE_FILE } as Track })));
      service.retryTakeUpload('take-1');
      expect(service.takeUploads()['take-1']).toBeUndefined();
      expect(service.takeRefs().map(ref => ref.fileId)).toEqual([TAKE_FILE]);
    });

    it('à l’ouverture, récupère les prises du projet et la prise active, sans modification en attente', async () => {
      const voice = {
        id: 'voice',
        name: 'Voix principale',
        type: 'vocal' as const,
        activeClipId: 'take-2',
        clips: [
          { id: 'take-1', startBeat: 0, durationBeats: 18, offsetSeconds: 0.05, audioFileId: 'f1', label: 'Prise 1' },
          { id: 'take-2', startBeat: 8, durationBeats: 30, offsetSeconds: 0, audioFileId: 'f2', label: 'Refrain' },
        ],
      };
      api.get.mockReturnValue(of({ ...stored, bpm: 90, tracks: [voice] }));
      service.load('p1');
      expect(tracksApi.audio.mock.calls.map(call => call[0])).toEqual(['f1', 'f2']);
      await vi.waitFor(() => expect(session.takes().length).toBe(2));
      expect(session.takes().map(take => take.name)).toEqual(['Prise 1', 'Refrain']);
      expect(session.take()?.id).toBe('take-2');
      expect(session.takes()[1].startSeconds).toBeCloseTo(8 * (60 / 90), 6);
      expect(service.saveState()).toBe('saved');
    });

    it('prise supprimée de la bibliothèque : message, puis retrait du projet sur demande', () => {
      const voice = { id: 'voice', name: 'Voix', type: 'vocal' as const, clips: [{ id: 'take-1', startBeat: 0, durationBeats: 8, audioFileId: 'f1', label: 'Prise 1' }] };
      api.get.mockReturnValue(of({ ...stored, tracks: [voice] }));
      tracksApi.audio.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      service.load('p1');
      expect(service.takeErrors()['take-1']).toContain('n’existe plus');
      expect(service.saveState()).toBe('saved');
      service.removeTake('take-1');
      expect(service.takeRefs()).toEqual([]);
      expect(service.saveState()).toBe('dirty');
    });

    it('session libre : la prise reste locale', async () => {
      fakeRecording(recorded('take-1', 'Prise 1'));
      await service.stopRecording();
      expect(tracksApi.upload).not.toHaveBeenCalled();
    });
  });
});
