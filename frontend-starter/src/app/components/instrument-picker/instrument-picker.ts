import { Component, ElementRef, OnDestroy, afterNextRender, inject, input, output } from '@angular/core';
import {
  INSTRUMENT_FAMILIES,
  INSTRUMENT_FAMILY_LABELS,
  INSTRUMENT_LABELS,
  InstrumentFamily,
  InstrumentId,
  defaultTrackFor,
  instrumentsOfFamily,
} from '../../shared/audio/melodic-pattern';
import { SOUND_LIBRARY } from '../../shared/audio/sound-library';
import { SoundPreviewService } from '../../shared/audio/sound-preview.service';

/** Phrase courte qui aide à choisir : à quoi sert l'instrument dans un morceau. */
const INSTRUMENT_HINTS: Readonly<Record<InstrumentId, string>> = {
  piano: 'Accords et mélodies',
  organ: 'Son tenu, ambiance gospel',
  acousticGuitar: 'Cordes pincées, folk',
  electricGuitar: 'Son saturé, rock',
  bass808: 'Sub grave du rap',
  electricBass: 'Basse jouée aux doigts',
  strings: 'Nappe d’orchestre',
  brass: 'Cuivres puissants',
  flute: 'Mélodie aérienne',
  synth: 'Lead électronique',
  pad: 'Fond d’ambiance',
  bells: 'Clochettes, boîte à musique',
};

/**
 * Sélecteur d'instruments : cartes groupées par famille, préécoute et ajout en un clic.
 * Le composant ne modifie pas le projet : il émet l'instrument choisi.
 */
@Component({
  selector: 'app-instrument-picker',
  templateUrl: './instrument-picker.html',
  styleUrl: './instrument-picker.css',
})
export class InstrumentPickerComponent implements OnDestroy {
  private readonly previewService = inject(SoundPreviewService);

  readonly picked = output<InstrumentId>();
  readonly closed = output<void>();
  readonly destination = input<string | null>(null);

  readonly families = INSTRUMENT_FAMILIES;
  readonly familyLabels = INSTRUMENT_FAMILY_LABELS;
  readonly labels = INSTRUMENT_LABELS;
  readonly hints = INSTRUMENT_HINTS;
  readonly playingId = this.previewService.playingId;
  readonly previewError = this.previewService.error;

  constructor() {
    // Ouvert depuis la timeline, le sélecteur peut être hors de l'écran : on l'amène en vue et on y place le focus.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      const title = host.nativeElement.querySelector<HTMLElement>('#picker-title');
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      host.nativeElement.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      title?.focus({ preventScroll: true });
    });
  }

  instrumentsOf(family: InstrumentFamily): InstrumentId[] {
    return instrumentsOfFamily(family);
  }

  trackName(instrument: InstrumentId): string {
    return this.destination() ?? (defaultTrackFor(instrument) === 'bass' ? 'Basse' : 'Mélodie');
  }

  isPlaying(instrument: InstrumentId): boolean {
    return this.playingId() === `instrument-${instrument}`;
  }

  preview(instrument: InstrumentId): void {
    const entry = SOUND_LIBRARY.find(sound => sound.id === `instrument-${instrument}`);
    if (entry) {
      void this.previewService.preview(entry);
    }
  }

  ngOnDestroy(): void {
    this.previewService.stop();
  }
}
