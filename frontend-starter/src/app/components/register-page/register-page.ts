import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { PASSWORD_MIN_LENGTH, authErrorMessage, safeReturnUrl } from '../../shared/utils/auth-form';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'));

  readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  readonly error = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)] }),
  });

  submit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, email, password } = this.form.getRawValue();
    this.error.set('');
    this.submitting.set(true);
    this.form.disable();
    this.auth.register(name.trim(), email.trim(), password).subscribe({
      next: () => {
        console.debug('[RegisterPage] Inscription réussie');
        void this.router.navigateByUrl(this.returnUrl);
      },
      error: (error: unknown) => {
        console.error('[RegisterPage] Échec de l’inscription', error instanceof Error ? error.message : error);
        this.error.set(authErrorMessage(error, 'L’inscription a échoué. Réessayez.'));
        this.submitting.set(false);
        this.form.enable();
      },
    });
  }
}
