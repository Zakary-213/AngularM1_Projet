import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarService, validateAvatarFile } from './avatar.service';
import { AuthService } from './auth.service';
import { User } from '../models/user.model';

const user: User = { id: 'u1', name: 'Zak', email: 'zak@example.com', createdAt: '' };
const png = (size = 10) => new File([new Uint8Array(size)], 'a.png', { type: 'image/png' });

describe('validateAvatarFile', () => {
  it('accepte une image PNG légère', () => expect(validateAvatarFile(png())).toBeNull());
  it('refuse un autre format', () =>
    expect(validateAvatarFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toContain('JPEG, PNG ou WebP'));
  it('refuse une image de plus de 2 Mo', () => expect(validateAvatarFile(png(2 * 1024 * 1024 + 1))).toContain('2 Mo'));
});

describe('AvatarService', () => {
  let service: AvatarService;
  let auth: AuthService;
  let http: HttpTestingController;
  let counter = 0;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:test-${++counter}`),
      revokeObjectURL: vi.fn(),
    }));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AvatarService);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('télécharge la photo quand le profil en possède une, puis la libère à la déconnexion', () => {
    auth.currentUser.set({ ...user, hasAvatar: true, avatarUpdatedAt: '2026-11-15T10:00:00Z' });
    TestBed.tick();
    const request = http.expectOne('/api/users/me/avatar');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['img']));
    const url = service.url();
    expect(url).toMatch(/^blob:test-/);

    auth.logout();
    TestBed.tick();
    expect(service.url()).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('envoie le fichier en multipart puis l’affiche sans le retélécharger', () => {
    auth.currentUser.set(user);
    TestBed.tick();
    let result: User | undefined;
    service.upload(png()).subscribe((u) => (result = u));

    const request = http.expectOne('/api/users/me/avatar');
    expect(request.request.method).toBe('PUT');
    expect((request.request.body as FormData).get('avatar')).toBeInstanceOf(File);
    request.flush({ ...user, hasAvatar: true, avatarUpdatedAt: '2026-11-15T11:00:00Z' });
    TestBed.tick();

    expect(result?.hasAvatar).toBe(true);
    expect(auth.currentUser()?.hasAvatar).toBe(true);
    expect(service.url()).toMatch(/^blob:test-/);
    http.expectNone('/api/users/me/avatar');
  });

  it('supprime la photo et met le profil à jour', () => {
    auth.currentUser.set({ ...user, hasAvatar: true, avatarUpdatedAt: 'v1' });
    TestBed.tick();
    http.expectOne({ method: 'GET', url: '/api/users/me/avatar' }).flush(new Blob(['img']));

    service.remove().subscribe();
    http.expectOne({ method: 'DELETE', url: '/api/users/me/avatar' }).flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    expect(auth.currentUser()?.hasAvatar).toBe(false);
    expect(service.url()).toBeNull();
  });
});
