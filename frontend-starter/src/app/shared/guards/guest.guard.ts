import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DEFAULT_AFTER_AUTH_URL } from '../utils/auth-form';

/** Sends an already logged-in user away from the login and registration pages. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.token() ? router.createUrlTree([DEFAULT_AFTER_AUTH_URL]) : true;
};
