import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PublicationService } from './publication.service';

describe('PublicationService — contrat HTTP', () => {
  let service: PublicationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PublicationService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lit la liste publique paginée et mes publications', () => {
    service.list(2, 12).subscribe();
    expect(http.expectOne('/api/publications?page=2&limit=12').request.method).toBe('GET');
    service.mine().subscribe();
    expect(http.expectOne('/api/publications/mine?page=1&limit=50').request.method).toBe('GET');
  });

  it('envoie le mix en multipart, champs texte avant le fichier, avec la progression', () => {
    const wav = new Blob(['RIFF'], { type: 'audio/wav' });
    service.publish({ projectId: 'p1', title: 'Minuit', description: 'Premier son' }, wav).subscribe();
    const request = http.expectOne('/api/publications');
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);
    const body = request.request.body as FormData;
    expect([...body.keys()]).toEqual(['projectId', 'title', 'description', 'audio']);
    expect(body.get('title')).toBe('Minuit');
    expect((body.get('audio') as File).name).toBe('mix.wav');
    request.flush({}, { status: 201, statusText: 'Created' });
  });

  it('retire une publication et donne son adresse d’écoute', () => {
    service.remove('abc').subscribe();
    expect(http.expectOne('/api/publications/abc').request.method).toBe('DELETE');
    expect(service.audioUrl('a/b')).toBe('/api/publications/a%2Fb/audio');
  });
});
