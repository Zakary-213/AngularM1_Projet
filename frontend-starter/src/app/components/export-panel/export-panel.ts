import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

const EXPORT_BAR_CHOICES = [1, 2, 4, 8] as const;
const DEFAULT_EXPORT_BARS = 4;

/** Export WAV du mix écouté : rendu hors temps réel avec le même graphe que la lecture. */
@Component({
  selector: 'app-export-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './export-panel.html',
  styleUrl: './export-panel.css',
})
export class ExportPanelComponent {
  readonly session = inject(StudioSessionService);
  readonly barChoices = EXPORT_BAR_CHOICES;
  readonly bars = new FormControl<number>(DEFAULT_EXPORT_BARS, { nonNullable: true });

  exportWav(): void {
    void this.session.exportWav(this.bars.value);
  }

  formatSeconds(seconds: number): string {
    return `${seconds.toFixed(2).replace('.', ',')} s`;
  }

  formatDecibels(decibels: number): string {
    return Number.isFinite(decibels) ? `${decibels.toFixed(1).replace('.', ',')} dBFS` : 'silence';
  }
}
