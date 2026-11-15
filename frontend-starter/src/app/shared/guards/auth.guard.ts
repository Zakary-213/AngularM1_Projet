import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protects routes that require a token issued by the API and remembers the
 * requested page so the user returns to it after logging in.
 * This only improves navigation: the backend still checks the JWT on every request.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.token() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
