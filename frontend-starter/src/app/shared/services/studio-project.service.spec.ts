import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioSessionService } from '../audio/studio-session.service';
import { MusicalProject, ProjectContent } from '../models/musical-project.model';
import { ProjectService } from './project.service';
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

describe('StudioProjectService', () => {
  let api: { get: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let service: StudioProjectService;
  let session: StudioSessionService;

  beforeEach(() => {
    api = { get: vi.fn(() => of(stored)), save: vi.fn() };
    TestBed.configureTestingModule({
      providers: [StudioSessionService, StudioProjectService, { provide: ProjectService, useValue: api }],
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
});
