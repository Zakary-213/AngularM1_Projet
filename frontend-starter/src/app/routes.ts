import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { guestGuard } from './shared/guards/guest.guard';
import { LoginPageComponent } from './components/login-page/login-page';
import { ProfilePageComponent } from './components/profile-page/profile-page';
import { RegisterPageComponent } from './components/register-page/register-page';
import { TracksPageComponent } from './components/tracks-page/tracks-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', title: 'Accueil · Zakat Record', loadComponent: () => import('./components/home-page/home-page').then(m => m.HomePageComponent) },
  { path: 'projects', title: 'Mes projets · Zakat Record', loadComponent: () => import('./components/projects-page/projects-page').then(m => m.ProjectsPageComponent) },
  { path: 'studio', title: 'Studio · Zakat Record', loadComponent: () => import('./components/studio-page/studio-page').then(m => m.StudioPageComponent) },
  { path: 'library', title: 'Bibliothèque · Zakat Record', loadComponent: () => import('./components/library-page/library-page').then(m => m.LibraryPageComponent) },
  { path: 'collaborations', title: 'Collaborations · Zakat Record', loadComponent: () => import('./components/collaborations-page/collaborations-page').then(m => m.CollaborationsPageComponent) },
  { path: 'publications', title: 'Publications · Zakat Record', loadComponent: () => import('./components/publications-page/publications-page').then(m => m.PublicationsPageComponent) },
  { path: 'login', title: 'Connexion · Zakat Record', component: LoginPageComponent, canActivate: [guestGuard] },
  { path: 'register', title: 'Inscription · Zakat Record', component: RegisterPageComponent, canActivate: [guestGuard] },
  { path: 'profile', title: 'Mon profil · Zakat Record', component: ProfilePageComponent, canActivate: [authGuard] },
  { path: 'tracks', component: TracksPageComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'home' },
];
