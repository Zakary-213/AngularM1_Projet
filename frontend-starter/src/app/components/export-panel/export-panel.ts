import { Component, computed, inject } from '@angular/core';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { MAX_EXPORT_SECONDS } from '../../shared/audio/song-length';
import { StudioProjectService } from '../../shared/services/studio-project.service';

/**
 * Export WAV du morceau entier (M10) : rendu hors temps réel avec le même graphe que la
 * lecture, sur toute la timeline (positions des clips, durée réelle des fichiers).
 */
@Component({
  selector: 'app-export-panel',
  templateUrl: './export-panel.html',
  styleUrl: './export-panel.css',
})
export class ExportPanelComponent {
  readonly session = inject(StudioSessionService);
  private readonly studioProject = inject(StudioProjectService, { optional: true });
  readonly maxMinutes = MAX_EXPORT_SECONDS / 60;

  readonly plan = this.session.exportPlan;
  readonly progressPercent = computed(() => {
    const progress = this.session.exportProgress();
    return progress === null ? null : Math.round(progress * 100);
  });
  /** Ce qui sera entendu sur la piste Voix dans le fichier. */
  readonly voiceSource = computed(() => {
    if (!this.session.take()) {
      return 'aucune prise';
    }
    return this.session.correctionActive() ? `version corrigée (${this.session.correctedTake()?.styleLabel})` : 'prise originale';
  });

  exportWav(): void {
    void this.session.exportWav(this.studioProject?.project()?.title ?? 'zakat-record');
  }

  formatSeconds(seconds: number): string {
    const total = Math.round(seconds * 10) / 10;
    const minutes = Math.floor(total / 60);
    const rest = (total - minutes * 60).toFixed(1).replace('.', ',');
    return minutes > 0 ? `${minutes} min ${rest} s` : `${rest} s`;
  }

  formatDecibels(decibels: number): string {
    return Number.isFinite(decibels) ? `${decibels.toFixed(1).replace('.', ',')} dBFS` : 'silence';
  }
}
