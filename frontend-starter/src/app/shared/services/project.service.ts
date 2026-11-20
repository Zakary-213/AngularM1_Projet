import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MusicalProject, NewProject, ProjectContent, ProjectSummary } from '../models/musical-project.model';
import { Page } from '../models/page.model';

/** Opérations HTTP sur les projets musicaux (routes /api/projects, JWT ajouté par l'intercepteur). */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);

  list(page = 1, limit = 12) {
    return this.http.get<Page<ProjectSummary>>('/api/projects', { params: { page, limit } });
  }

  create(project: NewProject) {
    return this.http.post<MusicalProject>('/api/projects', project);
  }

  get(id: string) {
    return this.http.get<MusicalProject>(`/api/projects/${encodeURIComponent(id)}`);
  }

  /** `revision` : celle du projet ouvert ; le serveur répond 409 si elle a changé entre-temps. */
  save(id: string, revision: number, content: ProjectContent) {
    return this.http.put<MusicalProject>(`/api/projects/${encodeURIComponent(id)}`, { revision, ...content });
  }

  rename(id: string, title: string) {
    return this.http.patch<MusicalProject>(`/api/projects/${encodeURIComponent(id)}`, { title });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/projects/${encodeURIComponent(id)}`);
  }
}
