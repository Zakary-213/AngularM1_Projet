import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePageComponent } from './profile-page';

const user = { id: 'u1', name: 'Zak', email: 'zak@example.com', createdAt: '2026-11-15T10:00:00Z', hasAvatar: false };

describe('ProfilePage — photo de profil', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;

  function pick(file: File): void {
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
    TestBed.configureTestingModule({ imports: [ProfilePageComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProfilePageComponent);
    element = fixture.nativeElement as HTMLElement;
    http.expectOne('/api/users/me').flush(user);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('refuse un fichier non image sans rien envoyer', () => {
    pick(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('JPEG, PNG ou WebP');
    http.expectNone('/api/users/me/avatar');
  });

  it('affiche un aperçu puis enregistre la photo choisie', () => {
    pick(new File([new Uint8Array(10)], 'moi.png', { type: 'image/png' }));
    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:preview');
    expect(element.textContent).toContain('pas encore enregistrée');

    const save = [...element.querySelectorAll('button')].find((b) => b.textContent?.includes('Enregistrer la photo'))!;
    save.click();
    fixture.detectChanges();
    expect(save.disabled).toBe(true);

    http.expectOne({ method: 'PUT', url: '/api/users/me/avatar' }).flush({ ...user, hasAvatar: true, avatarUpdatedAt: 'v1' });
    fixture.detectChanges();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Photo de profil mise à jour');
    expect(element.textContent).toContain('Changer la photo');
  });

  it('affiche l’erreur du serveur si l’image est trop lourde', () => {
    pick(new File([new Uint8Array(10)], 'moi.png', { type: 'image/png' }));
    [...element.querySelectorAll('button')].find((b) => b.textContent?.includes('Enregistrer la photo'))!.click();
    http.expectOne('/api/users/me/avatar').flush({ message: 'Image trop lourde (2 Mo maximum)' }, { status: 413, statusText: 'Payload Too Large' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Image trop lourde');
  });
});
