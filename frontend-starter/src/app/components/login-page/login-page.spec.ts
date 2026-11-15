import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPageComponent } from './login-page';

const user = { id: 'u1', name: 'Zak', email: 'zak@example.com', createdAt: '2026-11-15T10:00:00Z' };

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  function setup(returnUrl: string | null): void {
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
  }

  function fill(email: string, password: string): void {
    fixture.componentInstance.form.setValue({ email, password });
  }

  function submit(): void {
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('ne préremplit aucun identifiant et n’envoie rien si le formulaire est invalide', () => {
    setup(null);
    expect(fixture.componentInstance.form.getRawValue()).toEqual({ email: '', password: '' });
    submit();
    http.expectNone('/api/auth/login');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.field-error')).toHaveLength(2);
  });

  it('envoie les identifiants une seule fois puis revient à la page demandée', () => {
    setup('/tracks?page=2');
    fill('zak@example.com', 'Secret123');
    submit();
    submit();

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'zak@example.com', password: 'Secret123' });
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.auth-submit')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Connexion en cours');

    request.flush({ token: 'jwt', user });
    expect(navigate).toHaveBeenCalledWith('/tracks?page=2');
  });

  it('affiche une erreur claire après un 401 et permet un nouvel essai', () => {
    setup(null);
    fill('zak@example.com', 'mauvais');
    submit();
    http.expectOne('/api/auth/login').flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Email ou mot de passe incorrect.');
    expect(fixture.componentInstance.form.enabled).toBe(true);
    expect(fixture.componentInstance.submitting()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
