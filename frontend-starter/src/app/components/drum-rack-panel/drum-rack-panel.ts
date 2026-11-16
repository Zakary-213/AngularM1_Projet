import { Component, inject } from '@angular/core';
import { DRUM_VOICES, DRUM_VOICE_LABELS, DrumVoice } from '../../shared/audio/drum-pattern';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../../shared/audio/music-time';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

/** Drum Rack du studio : séquenceur 16 pas, batterie synthétisée, joué en boucle par le transport. */
@Component({
  selector: 'app-drum-rack-panel',
  templateUrl: './drum-rack-panel.html',
  styleUrl: './drum-rack-panel.css',
})
export class DrumRackPanelComponent {
  readonly session = inject(StudioSessionService);

  readonly voices = DRUM_VOICES;
  readonly voiceLabels = DRUM_VOICE_LABELS;
  readonly steps = Array.from({ length: STEPS_PER_BAR }, (_, step) => step);
  readonly stepsPerBeat = STEPS_PER_BEAT;

  stepLabel(voice: DrumVoice, step: number): string {
    const state = this.session.pattern()[voice][step] ? 'actif' : 'inactif';
    return `${this.voiceLabels[voice]}, pas ${step + 1}, ${state}`;
  }
}
