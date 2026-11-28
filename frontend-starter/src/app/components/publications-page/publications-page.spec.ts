import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicationsPageComponent, coverColor, formatDuration, keyLabel } from './publications-page';
import { AuthService } from '../../shared/services/auth.service';
import { Publication } from '../../shared/models/publication.model';

const publication = (id: string, title: string, authorName = 'Alice'): Publication => ({
  id, title, description: '', author: { id: 'u1', name: authorName }, bpm: 92, key: { root: 2, scale: 'minor' },
  durationSeconds: 125, mimeType: 'audio/wav', size: 1000, createdAt: '2026-11-28T10:00:00.000Z',
});

const page = (items: Publication[], total = items.length, current = 1, pages = 1) => ({ items, page: current, limit: 12, total, pages });

describe('PublicationsPageComponent', () => {
  let http: HttpTestingController;

  function setup(authenticated: boolean) {
    const token = signal<string | null>(authenticated ? 'jwt' : null);
    TestBed.configureTestingModule({
      imports: [PublicationsPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: computed(() => token() !== null) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PublicationsPageComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());

  it('affiche les morceaux publiés lus depuis l’API, avec un lecteur', () => {
    const { fixture, root } = setup(false);
    expect(root.textContent).toContain('Chargement des publications');
    http.expectOne('/api/publications?page=1&limit=12').flush(page([publication('a', 'Minuit', 'Bob')]));
    fixture.detectChanges();
    expect(root.querySelector('.release-card h3')?.textContent).toBe('Minuit');
    expect(root.textContent).toContain('Par Bob');
    expect(root.textContent).toContain('92 BPM · Ré mineur · 2 min 05 s');
    expect(root.querySelector('audio')?.getAttribute('src')).toBe('/api/publications/a/audio');
    expect(root.textContent).not.toContain('Mes publications');
  });

  it('affiche un état vide puis une erreur avec un bouton Réessayer', () => {
    const { fixture, component, root } = setup(false);
    http.expectOne('/api/publications?page=1&limit=12').flush(page([]));
    fixture.detectChanges();
    expect(root.textContent).toContain('Aucun morceau publié');
    component.reload();
    http.expectOne('/api/publications?page=1&limit=12').flush(null, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Réessayer');
  });

  it('charge la page suivante sans doublon', () => {
    const { fixture, component, root } = setup(false);
    http.expectOne('/api/publications?page=1&limit=12').flush(page([publication('a', 'Un')], 2, 1, 2));
    fixture.detectChanges();
    component.loadMore();
    http.expectOne('/api/publications?page=2&limit=12').flush(page([publication('a', 'Un'), publication('b', 'Deux')], 2, 2, 2));
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.release-card h3')).map(node => node.textContent)).toEqual(['Un', 'Deux']);
    expect(component.hasMore()).toBe(false);
  });

  it('connecté : liste mes publications et retire un morceau après confirmation', () => {
    const { fixture, component, root } = setup(true);
    http.expectOne('/api/publications?page=1&limit=12').flush(page([publication('a', 'Minuit')]));
    http.expectOne('/api/publications/mine?page=1&limit=50').flush(page([publication('a', 'Minuit')]));
    fixture.detectChanges();
    expect(root.textContent).toContain('Mes publications');
    root.querySelector<HTMLButtonElement>('.mine button')!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain('ses liens ne fonctionneront plus');
    root.querySelector<HTMLButtonElement>('.mine .danger')!.click();
    http.expectOne(request => request.method === 'DELETE' && request.url === '/api/publications/a').flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(component.mine()).toEqual([]);
    expect(component.items()).toEqual([]);
    expect(root.querySelector('.notice')?.textContent).toContain('« Minuit » a été retiré');
  });
});

describe('formatage des publications', () => {
  it('durée, tonalité et couleur de pochette stable', () => {
    expect(formatDuration(42.4)).toBe('42 s');
    expect(formatDuration(61)).toBe('1 min 01 s');
    expect(keyLabel({ root: 0, scale: 'major' })).toBe('Do majeur');
    expect(coverColor('abc')).toBe(coverColor('abc'));
  });
});
