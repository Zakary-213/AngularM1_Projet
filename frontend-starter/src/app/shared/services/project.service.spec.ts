import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from './project.service';

describe('ProjectService — contrat HTTP', () => {
  let service: ProjectService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ProjectService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('liste une page de projets', () => {
    service.list(2, 12).subscribe();
    const request = http.expectOne('/api/projects?page=2&limit=12');
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], page: 2, limit: 12, total: 0, pages: 1 });
  });

  it('crée un projet avec titre et parcours uniquement', () => {
    service.create({ title: 'Minuit', origin: 'import' }).subscribe();
    const request = http.expectOne('/api/projects');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'Minuit', origin: 'import' });
    request.flush({});
  });

  it('sauvegarde avec la révision ouverte', () => {
    const content = { bpm: 90, key: { root: 9, scale: 'minor' as const }, tracks: [], patterns: [] };
    service.save('abc', 3, content).subscribe();
    const request = http.expectOne('/api/projects/abc');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ revision: 3, ...content });
    request.flush({});
  });

  it('renomme, ouvre et supprime en encodant l’identifiant', () => {
    service.rename('a/b', 'Nouveau').subscribe();
    const rename = http.expectOne('/api/projects/a%2Fb');
    expect(rename.request.method).toBe('PATCH');
    expect(rename.request.body).toEqual({ title: 'Nouveau' });
    rename.flush({});

    service.get('abc').subscribe();
    http.expectOne({ method: 'GET', url: '/api/projects/abc' }).flush({});
    service.delete('abc').subscribe();
    http.expectOne({ method: 'DELETE', url: '/api/projects/abc' }).flush(null);
  });
});
