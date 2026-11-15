import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_AUTH_URL, authErrorMessage, safeReturnUrl } from './auth-form';

describe('safeReturnUrl', () => {
  it('garde un chemin interne avec ses paramètres', () => {
    expect(safeReturnUrl('/tracks?page=2')).toBe('/tracks?page=2');
  });

  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/login', '/register?x=1'])(
    'refuse %s et renvoie la page par défaut',
    (candidate) => expect(safeReturnUrl(candidate)).toBe(DEFAULT_AFTER_AUTH_URL),
  );
});

describe('authErrorMessage', () => {
  const http = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  it('traduit les statuts connus', () => {
    expect(authErrorMessage(http(0), 'x')).toContain('Serveur injoignable');
    expect(authErrorMessage(http(502), 'x')).toContain('Serveur injoignable');
    expect(authErrorMessage(http(401), 'x')).toBe('Email ou mot de passe incorrect.');
    expect(authErrorMessage(http(409), 'x')).toBe('Un compte existe déjà avec cet email.');
  });

  it('reprend le message du serveur, sinon le message par défaut', () => {
    expect(authErrorMessage(http(400, { message: 'Nom requis' }), 'x')).toBe('Nom requis');
    expect(authErrorMessage(http(500, 'texte'), 'défaut')).toBe('défaut');
    expect(authErrorMessage(new Error('boom'), 'défaut')).toBe('défaut');
  });
});
