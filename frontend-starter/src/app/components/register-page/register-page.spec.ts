import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPageComponent } from './register-page';
import { DEFAULT_AFTER_AUTH_URL } from '../../shared/utils/auth-form';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPageComponent>;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RegisterPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnUrl: 'https://evil.example' }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RegisterPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function submit(): void {
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('affiche la règle du mot de passe et bloque un mot de passe trop court', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Au moins 8 caractères');
    fixture.componentInstance.form.setValue({ name: 'Zak', email: 'zak@example.com', password: '1234567' });
    submit();
    http.expectNone('/api/auth/register');
    expect((fixture.nativeElement as HTMLElement).querySelector('#register-password-error')).not.toBeNull();
  });

  it('crée le compte, stocke le token et ignore un returnUrl externe', () => {
    fixture.componentInstance.form.setValue({ name: ' Zak ', email: 'zak@example.com', password: '12345678' });
    submit();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual({ name: 'Zak', email: 'zak@example.com', password: '12345678' });
    request.flush({ token: 'jwt', user: { id: 'u1', name: 'Zak', email: 'zak@example.com', createdAt: '' } }, { status: 201, statusText: 'Created' });

    expect(localStorage.getItem('gpc_token')).toBe('jwt');
    expect(navigate).toHaveBeenCalledWith(DEFAULT_AFTER_AUTH_URL);
  });

  it('signale un email déjà utilisé (409)', () => {
    fixture.componentInstance.form.setValue({ name: 'Zak', email: 'zak@example.com', password: '12345678' });
    submit();
    http.expectOne('/api/auth/register').flush({ message: 'Email déjà utilisé' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Un compte existe déjà');
  });
});
