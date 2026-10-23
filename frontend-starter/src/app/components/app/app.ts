import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  readonly menuOpen = signal(false);
  readonly navigation = [
    { path: '/home', label: 'Accueil' },
    { path: '/projects', label: 'Projets' },
    { path: '/library', label: 'Bibliothèque' },
    { path: '/collaborations', label: 'Collaborations' },
    { path: '/publications', label: 'Publications' },
  ];
}
