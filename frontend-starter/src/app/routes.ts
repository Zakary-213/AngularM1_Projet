import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { LoginPageComponent } from './components/login-page/login-page';
import { ProfilePageComponent } from './components/profile-page/profile-page';
import { RegisterPageComponent } from './components/register-page/register-page';
import { TracksPageComponent } from './components/tracks-page/tracks-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', title: 'Accueil · Rap Studio', loadComponent: () => import('./components/home-page/home-page').then(m => m.HomePageComponent) },
  { path: 'projects', title: 'Mes projets · Rap Studio', loadComponent: () => import('./components/projects-page/projects-page').then(m => m.ProjectsPageComponent) },
  { path: 'studio', title: 'Studio · Rap Studio', loadComponent: () => import('./components/studio-page/studio-page').then(m => m.StudioPageComponent) },
  { path: 'library', title: 'Bibliothèque · Rap Studio', loadComponent: () => import('./components/library-page/library-page').then(m => m.LibraryPageComponent) },
  { path: 'collaborations', title: 'Collaborations · Rap Studio', loadComponent: () => import('./components/collaborations-page/collaborations-page').then(m => m.CollaborationsPageComponent) },
  { path: 'publications', title: 'Publications · Rap Studio', loadComponent: () => import('./components/publications-page/publications-page').then(m => m.PublicationsPageComponent) },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'profile', component: ProfilePageComponent, canActivate: [authGuard] },
  { path: 'tracks', component: TracksPageComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'home' },
];
