import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NOTE_NAMES, SCALE_LABELS } from '../../shared/audio/pitch/musical-scale';
import { Publication } from '../../shared/models/publication.model';
import { AuthService } from '../../shared/services/auth.service';
import { PublicationService } from '../../shared/services/publication.service';

/** Nombre de morceaux chargés à chaque page de la liste publique. */
export const PUBLICATIONS_PAGE_SIZE = 12;
/** Couleurs de pochette existantes, choisies d'après l'identifiant (stable d'une visite à l'autre). */
const COVER_COLORS = ['lime', 'purple', 'peach', 'orange'] as const;

type LoadState = 'loading' | 'loaded' | 'error';

/** « 3 min 05 s » ou « 42 s ». */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${rest} s`;
}

export function keyLabel(key: Publication['key']): string {
  return `${NOTE_NAMES[key.root] ?? '?'} ${SCALE_LABELS[key.scale] ?? ''}`.trim();
}

export function coverColor(id: string): (typeof COVER_COLORS)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

/**
 * Page Publications (#80) : morceaux publiés par tous les utilisateurs, lus depuis l'API,
 * et, pour l'utilisateur connecté, ses propres publications avec la possibilité de les retirer.
 */
@Component({
  selector: 'app-publications-page',
  imports: [RouterLink],
  templateUrl: './publications-page.html',
  styleUrl: './publications-page.css',
})
export class PublicationsPageComponent {
  private readonly publications = inject(PublicationService);
  readonly auth = inject(AuthService);

  readonly items = signal<readonly Publication[]>([]);
  readonly total = signal(0);
  readonly state = signal<LoadState>('loading');
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  private page = 0;
  private pages = 1;
  readonly hasMore = computed(() => this.items().length < this.total());

  readonly mine = signal<readonly Publication[]>([]);
  readonly mineState = signal<LoadState>('loading');
  /** Publication dont le retrait attend une confirmation, puis celle en cours de retrait. */
  readonly confirmingId = signal<string | null>(null);
  readonly removingId = signal<string | null>(null);
  readonly removeError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly formatDuration = formatDuration;
  readonly keyLabel = keyLabel;
  readonly coverColor = coverColor;

  constructor() {
    this.reload();
  }

  audioUrl(publication: Publication): string {
    return this.publications.audioUrl(publication.id);
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Recharge la liste publique depuis la première page, et « Mes publications » si connecté. */
  reload(): void {
    this.page = 0;
    this.pages = 1;
    this.items.set([]);
    this.state.set('loading');
    this.loadPage();
    if (this.auth.isAuthenticated()) {
      this.loadMine();
    }
  }

  loadMore(): void {
    if (this.loadingMore() || this.page >= this.pages) return;
    this.loadingMore.set(true);
    this.loadPage();
  }

  private loadPage(): void {
    this.error.set(null);
    this.publications.list(this.page + 1, PUBLICATIONS_PAGE_SIZE).subscribe({
      next: result => {
        this.page = result.page;
        this.pages = result.pages;
        // Une publication arrivée entre deux pages décale la liste : on évite les doublons.
        const known = new Set(this.items().map(item => item.id));
        this.items.set([...this.items(), ...result.items.filter(item => !known.has(item.id))]);
        this.total.set(result.total);
        this.state.set('loaded');
        this.loadingMore.set(false);
      },
      error: (error: unknown) => {
        console.error('[publications] liste impossible', error);
        this.error.set('Impossible de charger les publications. Vérifiez votre connexion puis réessayez.');
        if (this.items().length === 0) this.state.set('error');
        this.loadingMore.set(false);
      },
    });
  }

  private loadMine(): void {
    this.mineState.set('loading');
    this.publications.mine().subscribe({
      next: result => {
        this.mine.set(result.items);
        this.mineState.set('loaded');
      },
      error: (error: unknown) => {
        console.error('[publications] mes publications impossibles', error);
        this.mineState.set('error');
      },
    });
  }

  askRemove(publication: Publication): void {
    this.removeError.set(null);
    this.confirmingId.set(publication.id);
  }

  cancelRemove(): void {
    this.confirmingId.set(null);
  }

  remove(publication: Publication): void {
    if (this.removingId()) return;
    this.removingId.set(publication.id);
    this.removeError.set(null);
    this.publications.remove(publication.id).subscribe({
      next: () => {
        console.log('[publications] publication retirée', { id: publication.id });
        this.mine.set(this.mine().filter(item => item.id !== publication.id));
        const before = this.items().length;
        this.items.set(this.items().filter(item => item.id !== publication.id));
        if (this.items().length < before) this.total.set(this.total() - 1);
        this.confirmingId.set(null);
        this.removingId.set(null);
        this.notice.set(`« ${publication.title} » a été retiré. Les liens vers ce morceau ne fonctionnent plus.`);
      },
      error: (error: unknown) => {
        console.error('[publications] retrait impossible', error);
        this.removingId.set(null);
        this.removeError.set('Le retrait a échoué. Réessayez.');
      },
    });
  }
}
