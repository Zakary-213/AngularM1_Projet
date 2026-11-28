import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SOUND_CATEGORIES, SOUND_CATEGORY_INFO, SOUND_LIBRARY, SoundCategory, SoundEntry, countByCategory, filterSounds } from '../../shared/audio/sound-library';
import { SoundPreviewService } from '../../shared/audio/sound-preview.service';

const SEARCH_MAX_LENGTH = 60;

@Component({
  selector: 'app-library-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './library-page.html',
  styleUrl: './library-page.css',
})
export class LibraryPageComponent implements OnDestroy {
  private readonly previewService = inject(SoundPreviewService);

  readonly categories = SOUND_CATEGORIES;
  readonly categoryInfo = SOUND_CATEGORY_INFO;
  readonly counts = countByCategory(SOUND_LIBRARY);
  readonly searchMaxLength = SEARCH_MAX_LENGTH;

  readonly search = new FormControl('', { nonNullable: true });
  private readonly query = toSignal(this.search.valueChanges, { initialValue: '' });

  /** Catégorie filtrée, ou `null` pour tout afficher. */
  readonly selectedCategory = signal<SoundCategory | null>(null);
  readonly sounds = computed(() => filterSounds(SOUND_LIBRARY, this.selectedCategory(), this.query()));
  readonly playingId = this.previewService.playingId;
  readonly previewError = this.previewService.error;

  /** Un second clic sur la catégorie active retire le filtre. */
  toggleCategory(category: SoundCategory): void {
    this.selectedCategory.update(current => (current === category ? null : category));
  }

  clearFilters(): void {
    this.selectedCategory.set(null);
    this.search.setValue('');
  }

  preview(sound: SoundEntry): void {
    void this.previewService.preview(sound);
  }

  ngOnDestroy(): void {
    this.previewService.stop();
  }
}
