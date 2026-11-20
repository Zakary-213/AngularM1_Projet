import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { StudioSessionService } from '../audio/studio-session.service';
import { StudioState, contentFingerprint, fromProject, toProjectContent } from '../audio/project-mapping';
import { MusicalProject, PROJECT_FORMAT_VERSION } from '../models/musical-project.model';
import { ProjectService } from './project.service';

export type ProjectLoadState = 'loading' | 'loaded' | 'error';
/** `dirty` : modifié localement ; `saved` : confirmé par le serveur ; `conflict` : modifié ailleurs. */
export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/**
 * Projet ouvert dans le studio : chargement, état de sauvegarde et sauvegarde.
 * Fourni par la page Studio, à côté de `StudioSessionService` dont il lit et
 * remplit l'état sérialisable (BPM, tonalité, pattern, mixeur).
 */
@Injectable()
export class StudioProjectService {
  private readonly projects = inject(ProjectService);
  private readonly session = inject(StudioSessionService);

  readonly project = signal<MusicalProject | null>(null);
  readonly loadState = signal<ProjectLoadState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  private readonly savedFingerprint = signal<string | null>(null);

  private readonly currentState = computed<StudioState>(() => ({
    bpm: this.session.bpm(),
    key: this.session.projectKey(),
    pattern: this.session.pattern(),
    mixer: this.session.mixer(),
  }));

  readonly hasUnsavedChanges = computed(
    () => this.project() !== null && this.savedFingerprint() !== contentFingerprint(this.currentState()),
  );

  readonly saveState = computed<ProjectSaveState>(() => {
    if (this.conflict()) return 'conflict';
    if (this.saving()) return 'saving';
    if (this.saveError()) return 'error';
    return this.hasUnsavedChanges() ? 'dirty' : 'saved';
  });

  load(id: string): void {
    this.loadState.set('loading');
    this.loadError.set(null);
    this.conflict.set(false);
    this.saveError.set(null);
    this.projects.get(id).subscribe({
      next: project => {
        if (project.formatVersion > PROJECT_FORMAT_VERSION) {
          // Ne pas l'ouvrir : une sauvegarde depuis cette version perdrait des données.
          console.warn('[studio-project] format non pris en charge', { id, formatVersion: project.formatVersion });
          this.fail('Ce projet a été enregistré par une version plus récente du studio : il ne peut pas être ouvert ici.');
          return;
        }
        this.apply(project);
        this.loadState.set('loaded');
        console.log('[studio-project] projet chargé', { id, revision: project.revision });
      },
      error: (error: unknown) => {
        console.error('[studio-project] chargement impossible', error);
        this.fail(error instanceof HttpErrorResponse && error.status === 404 ? 'Projet introuvable ou non autorisé.' : 'Le projet n’a pas pu être chargé.');
      },
    });
  }

  save(): void {
    const project = this.project();
    if (!project || this.saving() || this.conflict()) {
      return;
    }
    const state = this.currentState();
    this.saving.set(true);
    this.saveError.set(null);
    this.projects.save(project.id, project.revision, toProjectContent(state)).subscribe({
      next: saved => {
        this.project.set(saved);
        // Empreinte de l'état envoyé : une modification faite pendant la requête reste « non sauvegardée ».
        this.savedFingerprint.set(contentFingerprint(state));
        this.saving.set(false);
        console.log('[studio-project] projet sauvegardé', { id: saved.id, revision: saved.revision });
      },
      error: (error: unknown) => {
        console.error('[studio-project] sauvegarde impossible', error);
        this.saving.set(false);
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.conflict.set(true);
          return;
        }
        this.saveError.set(this.saveErrorMessage(error));
      },
    });
  }

  /** Abandonne les modifications locales et recharge la version du serveur (après un conflit). */
  reload(): void {
    const project = this.project();
    if (project) {
      this.load(project.id);
    }
  }

  private apply(project: MusicalProject): void {
    const state = fromProject(project);
    this.session.setBpm(state.bpm);
    this.session.projectKey.set(state.key);
    this.session.pattern.set(state.pattern);
    this.session.mixer.set(state.mixer);
    this.project.set(project);
    this.savedFingerprint.set(contentFingerprint(state));
  }

  private fail(message: string): void {
    this.project.set(null);
    this.loadError.set(message);
    this.loadState.set('error');
  }

  private saveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0 || error.status >= 500) return 'Serveur injoignable : vos modifications sont conservées ici, réessayez.';
      if (error.status === 404) return 'Ce projet n’existe plus ou ne vous appartient pas.';
      if (error.status === 422) return 'Format de projet non pris en charge : sauvegarde refusée.';
      const message = (error.error as { message?: unknown } | null)?.message;
      if (error.status === 400 && typeof message === 'string') return `Sauvegarde refusée : ${message}`;
    }
    return 'La sauvegarde a échoué. Réessayez.';
  }
}
