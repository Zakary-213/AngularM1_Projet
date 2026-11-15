import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { authErrorMessage, safeReturnUrl } from '../../shared/utils/auth-form';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'));

  readonly error = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.error.set('');
    this.submitting.set(true);
    this.form.disable();
    this.auth.login(email.trim(), password).subscribe({
      next: () => {
        console.debug('[LoginPage] Connexion réussie');
        void this.router.navigateByUrl(this.returnUrl);
      },
      error: (error: unknown) => {
        console.error('[LoginPage] Échec de connexion', error instanceof Error ? error.message : error);
        this.error.set(authErrorMessage(error, 'La connexion a échoué. Réessayez.'));
        this.submitting.set(false);
        this.form.enable();
      },
    });
  }
}
