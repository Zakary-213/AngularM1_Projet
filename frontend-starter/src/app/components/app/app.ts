import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { AvatarService } from '../../shared/services/avatar.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly avatar = inject(AvatarService);
  private readonly router = inject(Router);

  readonly menuOpen = signal(false);
  readonly navigation = [
    { path: '/home', label: 'Accueil' },
    { path: '/projects', label: 'Projets' },
    { path: '/library', label: 'Bibliothèque' },
    { path: '/publications', label: 'Publications' },
  ];

  constructor() {
    // After a reload only the token is stored: fetch the profile to show the user's name.
    // An expired token returns 401 and the interceptor logs the user out.
    if (this.auth.token() && !this.auth.currentUser()) {
      this.auth.profile().subscribe({
        next: (user) => console.debug('[App] Session restaurée', user.id),
        error: (error) => console.error('[App] Session non restaurée', error),
      });
    }
  }

  logout(): void {
    this.auth.logout();
    this.menuOpen.set(false);
    void this.router.navigateByUrl('/home');
  }
}
