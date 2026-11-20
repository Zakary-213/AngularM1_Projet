import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NOTE_NAMES, SCALE_LABELS } from '../../shared/audio/pitch/musical-scale';
import { PROJECT_TITLE_MAX_LENGTH, ProjectKeySignature, ProjectOrigin, ProjectSummary } from '../../shared/models/musical-project.model';
import { ProjectService } from '../../shared/services/project.service';

const PAGE_SIZE = 12;

type ListState = 'loading' | 'loaded' | 'error';

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0 || error.status >= 500) return 'Serveur injoignable. Vérifiez que l’API est lancée puis réessayez.';
    const message = (error.error as { message?: unknown } | null)?.message;
    if (error.status === 400 && typeof message === 'string') return message;
    if (error.status === 404) return 'Ce projet n’existe plus.';
  }
  return fallback;
}

/** « Mes projets » : liste paginée des projets de l'utilisateur, création, renommage et suppression. */
@Component({
  selector: 'app-projects-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
})
export class ProjectsPageComponent {
  private readonly projects = inject(ProjectService);
  private readonly router = inject(Router);

  readonly titleMaxLength = PROJECT_TITLE_MAX_LENGTH;
  readonly origins: readonly { value: ProjectOrigin; label: string; description: string }[] = [
    { value: 'create', label: 'Créer une prod', description: 'Partir d’un rythme de départ et composer dans le studio.' },
    { value: 'import', label: 'Importer une prod', description: 'Partir d’une instrumentale MP3 ou WAV à charger dans le studio.' },
  ];

  readonly createForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PROJECT_TITLE_MAX_LENGTH)] }),
    origin: new FormControl<ProjectOrigin>('create', { nonNullable: true }),
  });
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  readonly listState = signal<ListState>('loading');
  readonly listError = signal<string | null>(null);
  readonly items = signal<ProjectSummary[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);

  /** Projet dont une action (renommage, suppression) est en cours : bloque les doubles envois. */
  readonly busyId = signal<string | null>(null);
  readonly renamingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly renameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PROJECT_TITLE_MAX_LENGTH)] });
  /** Un `<form>` réactif a besoin d'un FormGroup pour émettre `ngSubmit`. */
  readonly renameForm = new FormGroup({ title: this.renameControl });

  constructor() {
    this.load(1);
  }

  load(page: number): void {
    this.listState.set('loading');
    this.listError.set(null);
    this.projects.list(page, PAGE_SIZE).subscribe({
      next: result => {
        // Page vidée par une suppression : on revient à la précédente.
        if (result.items.length === 0 && result.page > 1) {
          this.load(result.page - 1);
          return;
        }
        this.items.set(result.items);
        this.page.set(result.page);
        this.pages.set(result.pages);
        this.total.set(result.total);
        this.listState.set('loaded');
      },
      error: (error: unknown) => {
        console.error('[projects-page] liste impossible', error);
        this.listError.set(apiMessage(error, 'La liste des projets n’a pas pu être chargée.'));
        this.listState.set('error');
      },
    });
  }

  create(): void {
    const title = this.createForm.controls.title.value.trim();
    if (this.creating() || !title || this.createForm.invalid) {
      this.createForm.controls.title.setValue(title);
      this.createForm.markAllAsTouched();
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    this.projects.create({ title, origin: this.createForm.controls.origin.value }).subscribe({
      next: project => {
        console.log('[projects-page] projet créé', { id: project.id });
        void this.router.navigate(['/studio', project.id]);
      },
      error: (error: unknown) => {
        console.error('[projects-page] création impossible', error);
        this.creating.set(false);
        this.createError.set(apiMessage(error, 'Le projet n’a pas pu être créé.'));
      },
    });
  }

  startRename(project: ProjectSummary): void {
    this.confirmDeleteId.set(null);
    this.actionError.set(null);
    this.renameControl.setValue(project.title);
    this.renamingId.set(project.id);
  }

  cancelRename(): void {
    this.renamingId.set(null);
  }

  rename(project: ProjectSummary): void {
    const title = this.renameControl.value.trim();
    if (this.busyId() || !title || this.renameControl.invalid) {
      this.renameControl.markAsTouched();
      return;
    }
    this.busyId.set(project.id);
    this.projects.rename(project.id, title).subscribe({
      next: renamed => {
        this.items.update(items => items.map(item => (item.id === renamed.id ? { ...item, title: renamed.title, updatedAt: renamed.updatedAt } : item)));
        this.renamingId.set(null);
        this.busyId.set(null);
      },
      error: (error: unknown) => {
        console.error('[projects-page] renommage impossible', error);
        this.actionError.set(apiMessage(error, 'Le projet n’a pas pu être renommé.'));
        this.busyId.set(null);
      },
    });
  }

  askDelete(project: ProjectSummary): void {
    this.renamingId.set(null);
    this.actionError.set(null);
    this.confirmDeleteId.set(project.id);
  }

  delete(project: ProjectSummary): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(project.id);
    this.projects.delete(project.id).subscribe({
      next: () => {
        console.log('[projects-page] projet supprimé', { id: project.id });
        this.busyId.set(null);
        this.confirmDeleteId.set(null);
        this.load(this.page());
      },
      error: (error: unknown) => {
        console.error('[projects-page] suppression impossible', error);
        this.actionError.set(apiMessage(error, 'Le projet n’a pas pu être supprimé.'));
        this.busyId.set(null);
      },
    });
  }

  keyLabel(key: ProjectKeySignature): string {
    return `${NOTE_NAMES[key.root] ?? '?'} ${SCALE_LABELS[key.scale] ?? ''}`.trim();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }
}
