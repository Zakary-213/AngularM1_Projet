import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAX_TAKES, StudioSessionService, TAKE_NAME_MAX_LENGTH, TAKE_NUDGE_SECONDS, VocalTake } from '../../shared/audio/studio-session.service';
import { StudioProjectService } from '../../shared/services/studio-project.service';
import { MAX_VOCAL_TRACKS, VOCAL_TRACK_NAME_MAX_LENGTH } from '../../shared/audio/studio-tracks';
import { isVocalTrackId } from '../../shared/audio/track-mix';

/**
 * Prises de la piste Voix : choix du micro, prise active, renommage, suppression
 * et état d'envoi au serveur. Utilise les services fournis par la page Studio.
 */
@Component({
  selector: 'app-takes-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './takes-panel.html',
  styleUrl: './takes-panel.css',
})
export class TakesPanelComponent {
  readonly session = inject(StudioSessionService);
  readonly studioProject = inject(StudioProjectService);
  readonly maxTakes = MAX_TAKES;
  readonly maxVocalTracks = MAX_VOCAL_TRACKS;
  readonly maxTrackName = VOCAL_TRACK_NAME_MAX_LENGTH;
  readonly nameMaxLength = TAKE_NAME_MAX_LENGTH;
  readonly nudgeSeconds = TAKE_NUDGE_SECONDS;

  readonly renamingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly renameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(TAKE_NAME_MAX_LENGTH)] });
  /** Un `<form>` réactif a besoin d'un FormGroup pour émettre `ngSubmit`. */
  readonly renameForm = new FormGroup({ name: this.renameControl });
  readonly trackAction = signal<'rename' | 'remove' | null>(null);
  readonly trackName = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/u), Validators.maxLength(VOCAL_TRACK_NAME_MAX_LENGTH)] });
  readonly trackForm = new FormGroup({ name: this.trackName });

  constructor() {
    void this.session.refreshInputDevices();
  }

  onInputChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.session.selectedInputId.set(value || null);
  }

  armTrack(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (isVocalTrackId(id)) this.session.armVocalTrack(id);
    this.trackAction.set(null);
    this.renamingId.set(null);
    this.confirmDeleteId.set(null);
  }

  addTrack(): void {
    if (this.session.addVocalTrack()) {
      this.trackAction.set(null);
      this.renamingId.set(null);
      this.confirmDeleteId.set(null);
    }
  }

  startTrackRename(): void {
    this.trackName.setValue(this.session.armedVocalTrack().name);
    this.trackAction.set('rename');
  }

  renameTrack(): void {
    if (this.session.renameVocalTrack(this.session.armedVocalTrack().id, this.trackName.value)) this.trackAction.set(null);
    else this.trackName.markAsTouched();
  }

  removeTrack(): void {
    if (this.studioProject.removeVocalTrack(this.session.armedVocalTrack().id)) this.trackAction.set(null);
  }

  startRename(take: VocalTake): void {
    this.confirmDeleteId.set(null);
    this.renameControl.setValue(take.name);
    this.renamingId.set(take.id);
  }

  rename(take: VocalTake): void {
    if (this.studioProject.renameTake(take.id, this.renameControl.value)) {
      this.renamingId.set(null);
    } else {
      this.renameControl.markAsTouched();
    }
  }

  remove(take: VocalTake): void {
    this.studioProject.removeTake(take.id);
    this.confirmDeleteId.set(null);
  }

  /** Prises du projet non récupérées (fichier supprimé, réseau) : affichées avec leur erreur. */
  missingTakes(): { id: string; message: string }[] {
    const loaded = new Set(this.session.armedTakes().map(take => take.id));
    const references = new Set(this.studioProject.takeRefs().filter(ref => (ref.trackId ?? 'voice') === this.session.armedVocalTrack().id).map(ref => ref.id));
    return Object.entries(this.studioProject.takeErrors())
      .filter(([id]) => references.has(id) && !loaded.has(id))
      .map(([id, message]) => ({ id, message }));
  }

  /** Progression de l'envoi en %, ou `null` si aucun envoi n'est en cours. */
  uploadProgress(id: string): number | null {
    const upload = this.studioProject.takeUploads()[id];
    return upload?.state === 'uploading' ? upload.progress : null;
  }

  uploadError(id: string): string | null {
    const upload = this.studioProject.takeUploads()[id];
    return upload?.state === 'error' ? upload.message : null;
  }

  formatSeconds(seconds: number): string {
    const sign = seconds < 0 ? '−' : '';
    return `${sign}${Math.abs(seconds).toFixed(2).replace('.', ',')} s`;
  }
}
