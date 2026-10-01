import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent implements OnDestroy {
  private readonly service = inject(TrackService);

  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal(false);

  // État du lecteur audio et gestion de mémoire
  readonly audioUrl = signal('');
  readonly currentTrack = signal<Track | null>(null);
  readonly audioLoading = signal<string | null>(null);
  readonly audioError = signal<string | null>(null);

  // Filtre par titre / recherche
  readonly searchFilter = signal('');

  readonly filteredTracks = computed(() => {
    const query = this.searchFilter().trim().toLowerCase();
    if (!query) {
      return this.tracks();
    }
    return this.tracks().filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.originalName.toLowerCase().includes(query),
    );
  });

  readonly title = new FormControl('', { nonNullable: true });
  file?: File;

  constructor() {
    this.load();
  }

  ngOnDestroy(): void {
    // Nettoyage impératif de la mémoire : révoquer l'ObjectURL finale pour éviter toute fuite
    const currentUrl = this.audioUrl();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      console.debug('[TracksPage] ObjectURL révoquée lors de la destruction du composant (ngOnDestroy)');
    }
  }

  choose(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0];
    this.uploadError.set(null);
    this.uploadSuccess.set(false);
    console.debug('[TracksPage] Fichier sélectionné', this.file?.name);
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchFilter.set(value);
  }

  load(): void {
    this.loading.set(true);
    this.service.list(this.page()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        this.tracks.set(response.items);
        this.pages.set(response.pages);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('[TracksPage] Chargement impossible', error);
        this.loading.set(false);
      },
    });
  }

  go(page: number): void {
    this.page.set(page);
    this.load();
  }

  upload(fileInput?: HTMLInputElement): void {
    if (!this.file) return;

    // 1. Validation de l'Upload (Sécurité côté Navigateur)
    // Bloquer si le fichier dépasse 25 Mo (25 000 000 octets) ou n'est pas un format audio
    const MAX_FILE_SIZE = 25_000_000;
    const isAudio =
      this.file.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(this.file.name);

    if (this.file.size > MAX_FILE_SIZE || !isAudio) {
      this.uploadSuccess.set(false);
      if (this.file.size > MAX_FILE_SIZE) {
        this.uploadError.set(
          'Le fichier dépasse 25 Mo (25 000 000 octets). Envoi bloqué.',
        );
      } else {
        this.uploadError.set(
          "Le format du fichier n'est pas un format audio valide. Envoi bloqué.",
        );
      }
      return;
    }

    // 2. L'Expérience Utilisateur (UI/UX) de l'Upload
    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadSuccess.set(false);

    this.service.upload(this.file, this.title.value || this.file.name).subscribe({
      next: (track) => {
        console.debug('[TracksPage] Piste envoyée', track.id);
        this.uploading.set(false);
        this.uploadSuccess.set(true);
        this.uploadError.set(null);
        this.title.setValue('');
        this.file = undefined;
        if (fileInput) {
          fileInput.value = '';
        }
        this.page.set(1);
        this.load();
      },
      error: (error) => {
        console.error('[TracksPage] Envoi impossible', error);
        this.uploading.set(false);
        this.uploadSuccess.set(false);
        const serverMessage =
          error?.error?.message ||
          "Une erreur est survenue lors de l'envoi du fichier au serveur.";
        this.uploadError.set(serverMessage);
      },
    });
  }

  play(track: Track): void {
    this.audioError.set(null);
    this.audioLoading.set(track.id);

    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id);
        const previousUrl = this.audioUrl();
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        this.audioUrl.set(URL.createObjectURL(blob));
        this.currentTrack.set(track);
        this.audioLoading.set(null);
      },
      error: (error) => {
        console.error('[TracksPage] Lecture impossible', error);
        this.audioLoading.set(null);
        const message =
          error?.error?.message ||
          `Impossible de charger le fichier audio de "${track.title}". Vérifiez vos droits ou le serveur.`;
        this.audioError.set(message);
      },
    });
  }

  delete(track: Track): void {
    if (!confirm(`Supprimer définitivement la piste "${track.title}" ?`)) {
      return;
    }

    this.service.delete(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        if (this.currentTrack()?.id === track.id) {
          const currentUrl = this.audioUrl();
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          this.audioUrl.set('');
          this.currentTrack.set(null);
        }
        if (this.tracks().length === 1 && this.page() > 1) {
          this.page.set(this.page() - 1);
        }
        this.load();
      },
      error: (error) => {
        console.error('[TracksPage] Suppression impossible', error);
        const message =
          error?.error?.message ||
          `Échec de la suppression de la piste "${track.title}".`;
        this.audioError.set(message);
      },
    });
  }

  formatSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 Ko';
    if (bytes >= 1_000_000) {
      return (bytes / 1_000_000).toFixed(2) + ' Mo';
    }
    return (bytes / 1_000).toFixed(1) + ' Ko';
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  }

  formatMime(mime: string): string {
    if (!mime) return 'AUDIO';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'MP3';
    if (mime.includes('wav')) return 'WAV';
    if (mime.includes('ogg')) return 'OGG';
    if (mime.includes('flac')) return 'FLAC';
    if (mime.includes('aac')) return 'AAC';
    if (mime.includes('webm')) return 'WEBM';
    return mime.replace('audio/', '').toUpperCase();
  }
}
