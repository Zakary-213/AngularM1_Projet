import { Component, computed, inject } from '@angular/core';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { STUDIO_TRACKS, StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { EqBand, MAX_BAND_DB } from '../../shared/audio/three-band-eq';
import { MAX_TRACK_DB, MIN_TRACK_DB, isTrackAudible } from '../../shared/audio/track-mix';

/** Mixeur : volume, mute et solo de chaque piste, égaliseur de l'instrumentale ; appliqués à l'écoute et à l'export. */
@Component({
  selector: 'app-mixer-panel',
  templateUrl: './mixer-panel.html',
  styleUrl: './mixer-panel.css',
})
export class MixerPanelComponent {
  readonly session = inject(StudioSessionService);
  readonly tracks = STUDIO_TRACKS;
  readonly minDb = MIN_TRACK_DB;
  readonly maxDb = MAX_TRACK_DB;
  readonly maxBandDb = MAX_BAND_DB;
  readonly eqBands: readonly { band: EqBand; label: string; hint: string }[] = [
    { band: 'lowDb', label: 'Graves', hint: 'sous 200 Hz' },
    { band: 'midDb', label: 'Médiums', hint: 'autour de 1 kHz' },
    { band: 'highDb', label: 'Aigus', hint: 'au-dessus de 4 kHz' },
  ];

  /** Pistes rendues inaudibles par le solo d'une autre piste (affiché en texte, pas seulement en couleur). */
  readonly silencedBySolo = computed(() => {
    const mixer = this.session.mixer();
    return new Set(this.tracks.filter(track => !mixer[track.id].muted && !isTrackAudible(mixer, track.id)).map(track => track.id));
  });

  onVolume(track: StudioTrackInfo, event: Event): void {
    this.session.setTrack(track.id, { volumeDb: Number((event.target as HTMLInputElement).value) });
  }

  onEq(band: EqBand, event: Event): void {
    this.session.setInstrumentalEq({ [band]: Number((event.target as HTMLInputElement).value) });
  }

  resetEq(): void {
    this.session.setInstrumentalEq({ lowDb: 0, midDb: 0, highDb: 0 });
  }

  formatDb(decibels: number): string {
    const sign = decibels > 0 ? '+' : '';
    return `${sign}${decibels.toFixed(0)} dB`;
  }
}
