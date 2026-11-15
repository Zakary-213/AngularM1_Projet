import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app';
import { AuthService } from '../../shared/services/auth.service';

describe('AppComponent — en-tête et compte', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('propose Connexion et S’inscrire à un visiteur', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const account = (fixture.nativeElement as HTMLElement).querySelector('.header-account')!;
    expect(account.textContent).toContain('Connexion');
    expect(account.textContent).toContain('S’inscrire');
    http.expectNone('/api/users/me');
  });

  it('restaure le profil, affiche le nom puis déconnecte', () => {
    localStorage.setItem('gpc_token', 'jwt');
    TestBed.inject(AuthService).token.set('jwt');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AppComponent);
    http.expectOne('/api/users/me').flush({ id: 'u1', name: 'Zak', email: 'zak@example.com', createdAt: '' });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.account-link')?.textContent).toContain('Zak');
    element.querySelector<HTMLButtonElement>('.account-logout')!.click();
    fixture.detectChanges();

    expect(localStorage.getItem('gpc_token')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/home');
    expect(element.querySelector('.header-account')?.textContent).toContain('Connexion');
  });
});
