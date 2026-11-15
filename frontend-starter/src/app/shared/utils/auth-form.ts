import { HttpErrorResponse } from '@angular/common/http';

/** Must match the backend rule in `POST /api/auth/register`. */
export const PASSWORD_MIN_LENGTH = 8;

/** Page opened after login or registration when no safe return URL is given. */
export const DEFAULT_AFTER_AUTH_URL = '/projects';

/**
 * Accepts only in-app paths ("/projects", "/tracks?page=2") to avoid open redirects
 * through the `returnUrl` query parameter.
 */
export function safeReturnUrl(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return DEFAULT_AFTER_AUTH_URL;
  }
  if (candidate.startsWith('/login') || candidate.startsWith('/register')) {
    return DEFAULT_AFTER_AUTH_URL;
  }
  return candidate;
}

/** Turns an API error into a French message for the user. */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  // 0: network error; 502–504: the dev proxy or gateway cannot reach the API.
  if (error.status === 0 || (error.status >= 502 && error.status <= 504)) {
    return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
  }
  if (error.status === 401) {
    return 'Email ou mot de passe incorrect.';
  }
  if (error.status === 409) {
    return 'Un compte existe déjà avec cet email.';
  }
  const body: unknown = error.error;
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}
