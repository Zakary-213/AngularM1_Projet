import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Page } from '../models/page.model';
import { Publication, PublicationDraft } from '../models/publication.model';

/** Opérations HTTP des morceaux publiés (#80). */
@Injectable({ providedIn: 'root' })
export class PublicationService {
  private readonly http = inject(HttpClient);

  /** Publications de tous les utilisateurs, plus récentes d'abord (route publique). */
  list(page = 1, limit = 12) {
    return this.http.get<Page<Publication>>('/api/publications', { params: { page, limit } });
  }

  /** Publications de l'utilisateur connecté. */
  mine(page = 1, limit = 50) {
    return this.http.get<Page<Publication>>('/api/publications/mine', { params: { page, limit } });
  }

  /** Envoie le mix WAV ; les événements donnent l'avancement de l'envoi. */
  publish(draft: PublicationDraft, wav: Blob) {
    const body = new FormData();
    // Les champs texte précèdent le fichier : Multer les lit dans l'ordre du formulaire.
    body.append('projectId', draft.projectId);
    body.append('title', draft.title);
    body.append('description', draft.description);
    body.append('audio', wav, 'mix.wav');
    return this.http.post<Publication>('/api/publications', body, { observe: 'events', reportProgress: true });
  }

  remove(id: string) {
    return this.http.delete<void>(`/api/publications/${id}`);
  }

  /** Adresse d'écoute publique : le lecteur audio la charge directement (requêtes Range). */
  audioUrl(id: string): string {
    return `/api/publications/${encodeURIComponent(id)}/audio`;
  }
}
