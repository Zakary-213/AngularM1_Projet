import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

/** Must match the backend limits of `PUT /api/users/me/avatar`. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Returns a French error message, or null when the file can be sent. */
export function validateAvatarFile(file: File): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return 'Choisissez une image JPEG, PNG ou WebP.';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'Image trop lourde : 2 Mo maximum.';
  }
  return null;
}

/**
 * Profile picture of the logged-in user. The image is protected by the JWT, so it
 * is downloaded as a Blob and exposed through an ObjectURL that this service
 * revokes whenever it changes or the user logs out.
 */
@Injectable({ providedIn: 'root' })
export class AvatarService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly url = signal<string | null>(null);
  /** Version (avatarUpdatedAt) currently displayed, to avoid downloading it twice. */
  private loadedVersion: string | null = null;

  constructor() {
    // Follow the current user: download the picture when it changes, release it on logout.
    effect(() => {
      const user = this.auth.currentUser();
      if (!user?.hasAvatar) {
        this.setUrl(null, null);
        return;
      }
      const version = user.avatarUpdatedAt ?? 'unknown';
      if (version !== this.loadedVersion) {
        this.download(version);
      }
    });
  }

  upload(file: File): Observable<User> {
    const body = new FormData();
    body.append('avatar', file);
    return this.http.put<User>('/api/users/me/avatar', body).pipe(
      tap((user) => {
        // The file is already in memory: show it without downloading it again.
        this.setUrl(URL.createObjectURL(file), user.avatarUpdatedAt ?? 'unknown');
        this.auth.currentUser.set(user);
      }),
    );
  }

  remove(): Observable<void> {
    return this.http.delete<void>('/api/users/me/avatar').pipe(
      tap(() => {
        const user = this.auth.currentUser();
        if (user) this.auth.currentUser.set({ ...user, hasAvatar: false, avatarUpdatedAt: null });
      }),
    );
  }

  private download(version: string): void {
    this.loadedVersion = version;
    this.http.get('/api/users/me/avatar', { responseType: 'blob' }).subscribe({
      next: (blob) => {
        // Ignore a response that arrives after the user changed or logged out.
        if (this.loadedVersion === version) this.setUrl(URL.createObjectURL(blob), version);
      },
      error: (error) => {
        console.error('[AvatarService] Photo de profil indisponible', error);
        if (this.loadedVersion === version) this.setUrl(null, null);
      },
    });
  }

  private setUrl(url: string | null, version: string | null): void {
    const previous = this.url();
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.url.set(url);
    this.loadedVersion = version;
  }
}
