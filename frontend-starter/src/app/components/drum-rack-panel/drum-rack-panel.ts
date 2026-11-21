import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { clipsUsingPattern } from '../../shared/audio/arrangement';
import { DRUM_KITS, DRUM_KIT_LABELS, DRUM_VOICES, DRUM_VOICE_LABELS, DrumKit, DrumVoice, MAX_PATTERNS, PATTERN_NAME_MAX_LENGTH, velocityLabel } from '../../shared/audio/drum-pattern';
import { NOTE_NAMES } from '../../shared/audio/pitch/musical-scale';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../../shared/audio/music-time';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

/**
 * Drum Rack du studio : bibliothèque de patterns et séquenceur 16 pas avec vélocité.
 * Le pattern affiché est celui que l'on modifie ; chaque clip de la piste Batterie joue le sien.
 */
@Component({
  selector: 'app-drum-rack-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './drum-rack-panel.html',
  styleUrl: './drum-rack-panel.css',
})
export class DrumRackPanelComponent {
  readonly session = inject(StudioSessionService);

  readonly voices = DRUM_VOICES;
  readonly voiceLabels = DRUM_VOICE_LABELS;
  readonly steps = Array.from({ length: STEPS_PER_BAR }, (_, step) => step);
  readonly stepsPerBeat = STEPS_PER_BEAT;
  readonly maxPatterns = MAX_PATTERNS;
  readonly nameMaxLength = PATTERN_NAME_MAX_LENGTH;
  readonly kits = DRUM_KITS;
  readonly kitLabels = DRUM_KIT_LABELS;
  /** Note de la 808 (fondamentale de la tonalité du projet). */
  readonly bassNote = computed(() => NOTE_NAMES[this.session.projectKey().root]);

  readonly renaming = signal(false);
  readonly confirmDelete = signal(false);
  readonly patternMessage = signal<string | null>(null);
  readonly renameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PATTERN_NAME_MAX_LENGTH)] });
  /** Un `<form>` réactif a besoin d'un FormGroup pour émettre `ngSubmit`. */
  readonly renameForm = new FormGroup({ name: this.renameControl });

  /** Nombre de clips de la timeline qui jouent le pattern affiché. */
  readonly usage = computed(() => clipsUsingPattern(this.session.drumClips(), this.session.editedPatternId()));

  velocityAt(voice: DrumVoice, step: number): number {
    return this.session.pattern()[voice][step];
  }

  stepLabel(voice: DrumVoice, step: number): string {
    const velocity = this.velocityAt(voice, step);
    const state = velocity > 0 ? `frappe ${velocityLabel(velocity)}` : 'vide';
    return `${this.voiceLabels[voice]}, pas ${step + 1}, ${state}`;
  }

  rowLabel(voice: DrumVoice): string {
    return voice === 'bass808' ? `808 (${this.bassNote()})` : this.voiceLabels[voice];
  }

  onKitChange(event: Event): void {
    this.session.setPatternKit(this.session.editedPatternId(), (event.target as HTMLSelectElement).value as DrumKit);
  }

  onPatternChange(event: Event): void {
    this.resetPanels();
    this.session.selectPattern((event.target as HTMLSelectElement).value);
  }

  create(): void {
    this.resetPanels();
    if (!this.session.createPattern()) {
      this.patternMessage.set(`${MAX_PATTERNS} patterns maximum (batterie et instruments).`);
    }
  }

  duplicate(): void {
    this.resetPanels();
    if (!this.session.duplicatePattern(this.session.editedPatternId())) {
      this.patternMessage.set(`${MAX_PATTERNS} patterns maximum (batterie et instruments).`);
    }
  }

  startRename(): void {
    this.resetPanels();
    this.renameControl.setValue(this.session.editedPattern().name);
    this.renaming.set(true);
  }

  rename(): void {
    if (this.session.renamePattern(this.session.editedPatternId(), this.renameControl.value)) {
      this.renaming.set(false);
    } else {
      this.renameControl.markAsTouched();
    }
  }

  askDelete(): void {
    this.resetPanels();
    this.confirmDelete.set(true);
  }

  delete(): void {
    this.confirmDelete.set(false);
    this.patternMessage.set(this.session.deletePattern(this.session.editedPatternId()));
  }

  private resetPanels(): void {
    this.renaming.set(false);
    this.confirmDelete.set(false);
    this.patternMessage.set(null);
  }
}
