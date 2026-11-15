import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let auth: AuthService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    auth = TestBed.inject(AuthService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    auth.token.set('jwt');
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('ajoute le header Authorization quand un token existe', () => {
    client.get('/api/users/me').subscribe();
    expect(http.expectOne('/api/users/me').request.headers.get('Authorization')).toBe('Bearer jwt');
  });

  it('déconnecte et renvoie vers /login après un 401 sur une route protégée', () => {
    client.get('/api/tracks').subscribe({ error: () => undefined });
    http.expectOne('/api/tracks').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(auth.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/' } });
  });

  it('ne déconnecte pas sur un 401 de la route de connexion', () => {
    client.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(auth.token()).toBe('jwt');
    expect(navigate).not.toHaveBeenCalled();
  });
});
