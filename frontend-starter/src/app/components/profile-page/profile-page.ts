import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { AvatarService, validateAvatarFile } from '../../shared/services/avatar.service';
import { authErrorMessage } from '../../shared/utils/auth-form';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent {
  readonly auth = inject(AuthService);
  readonly avatar = inject(AvatarService);

  readonly loadError = signal('');
  /** File chosen but not sent yet, with its local preview. */
  readonly pendingFile = signal<File | null>(null);
  readonly pendingPreview = signal<string | null>(null);
  readonly avatarBusy = signal(false);
  readonly avatarError = signal('');
  readonly avatarSuccess = signal('');
  readonly nameBusy = signal(false);
  readonly nameMessage = signal('');
  readonly nameError = signal('');

  readonly displayedAvatar = computed(() => this.pendingPreview() ?? this.avatar.url());
  readonly initial = computed(() => (this.auth.currentUser()?.name.charAt(0) ?? '♪').toUpperCase());

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
  });

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => this.clearPending());
  }

  load(): void {
    this.loadError.set('');
    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.form.setValue({ name: user.name });
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Chargement impossible', error);
        this.loadError.set(authErrorMessage(error, 'Impossible de charger votre profil.'));
      },
    });
  }

  chooseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so choosing the same file again still triggers a change.
    input.value = '';
    this.avatarSuccess.set('');
    if (!file) return;

    const error = validateAvatarFile(file);
    if (error) {
      this.avatarError.set(error);
      return;
    }
    this.avatarError.set('');
    this.clearPending();
    this.pendingFile.set(file);
    this.pendingPreview.set(URL.createObjectURL(file));
  }

  cancelPending(): void {
    this.clearPending();
    this.avatarError.set('');
  }

  saveAvatar(): void {
    const file = this.pendingFile();
    if (!file || this.avatarBusy()) return;
    this.avatarBusy.set(true);
    this.avatarError.set('');
    this.avatar.upload(file).subscribe({
      next: () => {
        console.debug('[ProfilePage] Photo de profil enregistrée');
        this.clearPending();
        this.avatarBusy.set(false);
        this.avatarSuccess.set('Photo de profil mise à jour.');
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Envoi de la photo impossible', error);
        this.avatarBusy.set(false);
        this.avatarError.set(authErrorMessage(error, 'La photo n’a pas pu être envoyée. Réessayez.'));
      },
    });
  }

  removeAvatar(): void {
    if (this.avatarBusy() || !confirm('Supprimer votre photo de profil ?')) return;
    this.avatarBusy.set(true);
    this.avatarError.set('');
    this.avatarSuccess.set('');
    this.avatar.remove().subscribe({
      next: () => {
        this.avatarBusy.set(false);
        this.avatarSuccess.set('Photo de profil supprimée.');
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Suppression de la photo impossible', error);
        this.avatarBusy.set(false);
        this.avatarError.set(authErrorMessage(error, 'La photo n’a pas pu être supprimée.'));
      },
    });
  }

  saveName(): void {
    if (this.nameBusy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.nameBusy.set(true);
    this.nameMessage.set('');
    this.nameError.set('');
    this.auth.update(this.form.getRawValue().name.trim()).subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil enregistré', user.id);
        this.nameBusy.set(false);
        this.nameMessage.set('Nom enregistré.');
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Enregistrement impossible', error);
        this.nameBusy.set(false);
        this.nameError.set(authErrorMessage(error, 'Le nom n’a pas pu être enregistré.'));
      },
    });
  }

  private clearPending(): void {
    const preview = this.pendingPreview();
    if (preview) URL.revokeObjectURL(preview);
    this.pendingPreview.set(null);
    this.pendingFile.set(null);
  }
}
