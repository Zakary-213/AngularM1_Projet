import { Component, computed, inject } from '@angular/core';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { STUDIO_TRACKS, StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { MAX_TRACK_DB, MIN_TRACK_DB, isTrackAudible } from '../../shared/audio/track-mix';

/** Mixeur : volume, mute et solo de chaque piste, appliqués à l'écoute et à l'export. */
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

  /** Pistes rendues inaudibles par le solo d'une autre piste (affiché en texte, pas seulement en couleur). */
  readonly silencedBySolo = computed(() => {
    const mixer = this.session.mixer();
    return new Set(this.tracks.filter(track => !mixer[track.id].muted && !isTrackAudible(mixer, track.id)).map(track => track.id));
  });

  onVolume(track: StudioTrackInfo, event: Event): void {
    this.session.setTrack(track.id, { volumeDb: Number((event.target as HTMLInputElement).value) });
  }

  formatDb(decibels: number): string {
    const sign = decibels > 0 ? '+' : '';
    return `${sign}${decibels.toFixed(0)} dB`;
  }
}
