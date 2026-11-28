import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { CONTENT_TRACK_LABELS } from '../../shared/audio/track-content';
import { isInstrumentTrackId } from '../../shared/audio/melodic-pattern';
import { PUBLICATION_LIMITS, Publication } from '../../shared/models/publication.model';
import { PublicationService } from '../../shared/services/publication.service';
import { StudioProjectService } from '../../shared/services/studio-project.service';

/** Étapes de la publication, affichées à l'utilisateur. */
export type PublishState =
  | { readonly step: 'idle' }
  | { readonly step: 'rendering' }
  | { readonly step: 'uploading'; readonly percent: number | null }
  | { readonly step: 'done'; readonly publication: Publication }
  | { readonly step: 'error'; readonly message: string };

/** Message clair pour une réponse d'erreur du serveur. */
export function publishErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const serverMessage = typeof error.error?.message === 'string' ? error.error.message : null;
    if (error.status === 0) return 'Serveur injoignable : vérifiez votre connexion puis réessayez.';
    if (error.status === 401) return 'Session expirée : reconnectez-vous pour publier.';
    if (serverMessage) return serverMessage;
  }
  return 'La publication a échoué. Réessayez.';
}

/**
 * « Publier le son » (#80) : rend le mix avec le moteur de l'export puis l'envoie au serveur.
 * Publier est distinct de sauvegarder : le projet reste privé, seul ce mix devient public.
 */
@Component({
  selector: 'app-publish-panel',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './publish-panel.html',
  styleUrl: './publish-panel.css',
})
export class PublishPanelComponent {
  readonly session = inject(StudioSessionService);
  readonly studioProject = inject(StudioProjectService);
  private readonly publications = inject(PublicationService);

  readonly closed = output<void>();

  readonly limits = PUBLICATION_LIMITS;
  readonly maxMegabytes = PUBLICATION_LIMITS.maxBytes / 1024 / 1024;
  readonly state = signal<PublishState>({ step: 'idle' });
  readonly renderPercent = computed(() => {
    const progress = this.session.exportProgress();
    return progress === null ? null : Math.round(progress * 100);
  });
  readonly busy = computed(() => ['rendering', 'uploading'].includes(this.state().step));

  /** Le tempo et la tonalité publiés sont ceux du projet sauvegardé : il faut sauvegarder avant. */
  readonly blocker = computed(() => {
    const save = this.studioProject.saveState();
    if (!this.studioProject.project()) return 'Ouvrez un projet sauvegardé pour publier.';
    if (save === 'conflict') return 'Réglez d’abord le conflit de sauvegarde.';
    if (save !== 'saved') return 'Sauvegardez le projet avant de le publier.';
    if (this.session.tracksWithContent().length === 0) {
      return 'Rien à publier : il faut au moins une piste avec du son (un rythme de batterie, des notes de mélodie ou de basse, une instrumentale ou une prise de voix).';
    }
    return null;
  });

  /** Pistes qui seront entendues dans le morceau publié, en clair. */
  readonly publishedTracks = computed(() => this.session.tracksWithContent().map(track => {
    if (!isInstrumentTrackId(track)) return CONTENT_TRACK_LABELS[track];
    return this.session.instrumentTracks().find(lane => lane.id === track)?.name ?? 'Instrument';
  }).join(', '));

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PUBLICATION_LIMITS.titleMaxLength), Validators.pattern(/\S/)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(PUBLICATION_LIMITS.descriptionMaxLength)] }),
  });

  private upload: Subscription | null = null;

  constructor() {
    this.form.controls.title.setValue(this.studioProject.project()?.title ?? '');
    inject(DestroyRef).onDestroy(() => this.upload?.unsubscribe());
    // Ouvert depuis l'en-tête, le panneau est amené en vue et reçoit le focus.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      host.nativeElement.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      host.nativeElement.querySelector<HTMLElement>('#publish-title')?.focus({ preventScroll: true });
    });
  }

  async publish(): Promise<void> {
    const project = this.studioProject.project();
    if (this.busy() || this.blocker() || !project) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.state.set({ step: 'rendering' });
    const rendered = await this.session.renderWav();
    // Le rapport d'export décrit un téléchargement : il ne doit pas apparaître après une publication.
    this.session.exportReport.set(null);
    if (!rendered) {
      this.state.set({ step: 'error', message: this.session.exportError() ?? 'Le rendu du morceau a échoué.' });
      this.session.exportError.set(null);
      return;
    }
    if (rendered.wav.size > PUBLICATION_LIMITS.maxBytes) {
      this.state.set({ step: 'error', message: `Morceau trop long pour être publié : ${this.maxMegabytes} Mo maximum, soit environ 5 min 50 s.` });
      return;
    }
    const { title, description } = this.form.getRawValue();
    this.state.set({ step: 'uploading', percent: 0 });
    this.upload = this.publications.publish({ projectId: project.id, title: title.trim(), description: description.trim() }, rendered.wav).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) {
          this.state.set({ step: 'uploading', percent: event.total ? Math.round((event.loaded / event.total) * 100) : null });
        } else if (event.type === HttpEventType.Response && event.body) {
          console.log('[publish] morceau publié', { id: event.body.id });
          this.state.set({ step: 'done', publication: event.body });
        }
      },
      error: (error: unknown) => {
        console.error('[publish] publication impossible', error);
        this.state.set({ step: 'error', message: publishErrorMessage(error) });
      },
    });
  }

  close(): void {
    this.upload?.unsubscribe();
    this.closed.emit();
  }
}
