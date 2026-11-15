import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard } from './auth.guard';
import { guestGuard } from './guest.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
  const run = (url: string) =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
  });

  it('redirige vers /login en mémorisant la page demandée', () => {
    const result = run('/tracks?page=2') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/login?returnUrl=%2Ftracks%3Fpage%3D2');
  });

  it('laisse passer un utilisateur avec token', () => {
    TestBed.inject(AuthService).token.set('jwt');
    expect(run('/tracks')).toBe(true);
  });

  it('renvoie un utilisateur déjà connecté hors des pages de connexion', () => {
    const guest = () => TestBed.runInInjectionContext(() => guestGuard({} as ActivatedRouteSnapshot, { url: '/login' } as RouterStateSnapshot));
    expect(guest()).toBe(true);
    TestBed.inject(AuthService).token.set('jwt');
    expect(TestBed.inject(Router).serializeUrl(guest() as UrlTree)).toBe('/projects');
  });
});
