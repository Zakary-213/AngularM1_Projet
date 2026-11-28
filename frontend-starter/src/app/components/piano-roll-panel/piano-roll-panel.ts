import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DEFAULT_NOTE_LENGTH,
  INSTRUMENT_FAMILIES,
  INSTRUMENT_FAMILY_LABELS,
  INSTRUMENT_LABELS,
  INSTRUMENT_RANGES,
  InstrumentFamily,
  InstrumentId,
  MAX_RELEASE_SECONDS,
  MELODIC_BAR_CHOICES,
  MIN_RELEASE_SECONDS,
  MelodicBars,
  MidiNote,
  NOTE_LENGTH_CHOICES,
  cellAtPoint,
  defaultTrackFor,
  describeNote,
  instrumentsOfFamily,
  isBlackKey,
  noteAt,
  noteName,
  patternSteps,
  pitchRows,
} from '../../shared/audio/melodic-pattern';
import { MAX_PATTERNS, PATTERN_NAME_MAX_LENGTH } from '../../shared/audio/drum-pattern';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../../shared/audio/music-time';
import { instrumentClipsUsing } from '../../shared/audio/note-scheduling';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

/** Taille d'une case de la grille, en pixels (piano-roll-panel.css s'y réfère par variables CSS). */
const STEP_WIDTH_PX = 28;
const ROW_HEIGHT_PX = 22;
/** Seuil en pixels au-delà duquel un appui sur une note devient un glissement. */
const DRAG_THRESHOLD_PX = 4;

const NOTE_LENGTH_LABELS: Readonly<Record<(typeof NOTE_LENGTH_CHOICES)[number], string>> = {
  1: 'Double-croche (1 pas)',
  2: 'Croche (2 pas)',
  4: 'Noire (4 pas)',
  8: 'Blanche (8 pas)',
  16: 'Ronde (16 pas)',
};

/** Glissement en cours : déplacement de la note, ou redimensionnement par sa poignée droite. */
interface NoteDrag {
  readonly note: MidiNote;
  readonly mode: 'move' | 'resize';
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
}

/**
 * Piano Roll (M4) : hauteur en vertical (aigus en haut), temps en horizontal (pas de
 * double-croche). Le pattern affiché est celui que l'on modifie ; chaque clip des pistes
 * Mélodie et Basse joue le sien. La logique des notes vit dans `melodic-pattern.ts`.
 */
@Component({
  selector: 'app-piano-roll-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './piano-roll-panel.html',
  styleUrl: './piano-roll-panel.css',
})
export class PianoRollPanelComponent {
  readonly session = inject(StudioSessionService);

  readonly families = INSTRUMENT_FAMILIES;
  readonly familyLabels = INSTRUMENT_FAMILY_LABELS;
  readonly instrumentLabels = INSTRUMENT_LABELS;
  readonly instrumentsOf = (family: InstrumentFamily): InstrumentId[] => instrumentsOfFamily(family);
  readonly barChoices = MELODIC_BAR_CHOICES;
  readonly lengthChoices = NOTE_LENGTH_CHOICES;
  readonly lengthLabels = NOTE_LENGTH_LABELS;
  readonly minRelease = MIN_RELEASE_SECONDS;
  readonly maxRelease = MAX_RELEASE_SECONDS;
  readonly maxPatterns = MAX_PATTERNS;
  readonly nameMaxLength = PATTERN_NAME_MAX_LENGTH;
  readonly stepWidth = STEP_WIDTH_PX;
  readonly rowHeight = ROW_HEIGHT_PX;
  readonly noteName = noteName;
  readonly isBlackKey = isBlackKey;

  readonly pattern = this.session.editedMelodicPattern;
  readonly range = computed(() => INSTRUMENT_RANGES[this.pattern().instrument]);
  readonly rows = computed(() => pitchRows(this.range()));
  readonly steps = computed(() => patternSteps(this.pattern()));
  readonly stepIndexes = computed(() => Array.from({ length: this.steps() }, (_, step) => step));
  readonly track = computed(() => defaultTrackFor(this.pattern().instrument));
  readonly trackLabel = computed(() => (this.track() === 'bass' ? 'Basse' : 'Mélodie'));
  readonly usage = computed(() => instrumentClipsUsing(this.session.instrumentClips(), this.pattern().id));
  readonly patternCount = computed(() => this.session.patterns().length + this.session.melodicPatterns().length);
  readonly auditioning = computed(() => this.session.auditionPatternId() === this.pattern().id && this.session.playing());

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedNote = computed(() => this.pattern().notes.find(note => note.id === this.selectedNoteId()) ?? null);
  /** Aperçu du glissement : décalage en pas et en demi-tons, ou allongement en pas. */
  readonly dragPreview = signal<{ readonly id: string; readonly steps: number; readonly pitch: number; readonly mode: 'move' | 'resize' } | null>(null);
  private drag: NoteDrag | null = null;

  readonly message = signal<string | null>(null);
  readonly renaming = signal(false);
  readonly confirmDelete = signal(false);
  readonly renameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PATTERN_NAME_MAX_LENGTH)] });
  readonly renameForm = new FormGroup({ name: this.renameControl });

  /** Longueur des notes posées au clic, et formulaire d'ajout au clavier. */
  readonly noteLength = new FormControl<number>(DEFAULT_NOTE_LENGTH, { nonNullable: true });
  readonly addForm = new FormGroup({
    pitch: new FormControl<number>(60, { nonNullable: true }),
    bar: new FormControl<number>(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    step: new FormControl<number>(1, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(STEPS_PER_BAR)] }),
  });

  readonly barCount = computed(() => this.pattern().bars);

  constructor() {
    // La hauteur proposée au clavier reste dans la tessiture de l'instrument affiché.
    effect(() => {
      const { low, high } = this.range();
      const pitch = this.addForm.controls.pitch;
      if (pitch.value < low || pitch.value > high) {
        pitch.setValue(Math.round((low + high) / 2));
      }
    });
  }

  // ——— Patterns ———

  onPatternChange(event: Event): void {
    this.resetPanels();
    this.session.selectMelodicPattern((event.target as HTMLSelectElement).value);
  }

  onInstrumentChange(event: Event): void {
    this.session.setMelodicInstrument(this.pattern().id, (event.target as HTMLSelectElement).value as InstrumentId);
  }

  onBarsChange(event: Event): void {
    this.session.setMelodicBars(this.pattern().id, Number((event.target as HTMLSelectElement).value) as MelodicBars);
  }

  onTone(event: Event): void {
    this.session.setMelodicParams(this.pattern().id, { tone: Number((event.target as HTMLInputElement).value) / 100 });
  }

  onRelease(event: Event): void {
    this.session.setMelodicParams(this.pattern().id, { releaseSeconds: Number((event.target as HTMLInputElement).value) });
  }

  create(instrument?: InstrumentId): void {
    this.resetPanels();
    if (!this.session.createMelodicPattern(instrument)) {
      this.message.set(`${MAX_PATTERNS} patterns maximum (batterie et instruments).`);
    }
  }

  duplicate(): void {
    this.resetPanels();
    if (!this.session.duplicateMelodicPattern(this.pattern().id)) {
      this.message.set(`${MAX_PATTERNS} patterns maximum (batterie et instruments).`);
    }
  }

  startRename(): void {
    this.resetPanels();
    this.renameControl.setValue(this.pattern().name);
    this.renaming.set(true);
  }

  rename(): void {
    if (this.session.renameMelodicPattern(this.pattern().id, this.renameControl.value)) {
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
    this.message.set(this.session.deleteMelodicPattern(this.pattern().id));
  }

  /** Place le pattern sur sa piste, à la mesure de la tête de lecture. */
  placeOnTimeline(): void {
    this.resetPanels();
    const id = this.session.addInstrumentClipAtPlayhead(this.track(), this.pattern().id);
    this.message.set(id ? null : 'Impossible d’ajouter un clip : limite de clips atteinte.');
  }

  // ——— Notes ———

  /** Clic dans une case vide : pose une note de la longueur choisie. */
  onGridClick(event: MouseEvent): void {
    const grid = event.currentTarget as HTMLElement;
    const rect = grid.getBoundingClientRect();
    const cell = cellAtPoint(event.clientX - rect.left, event.clientY - rect.top, {
      stepWidth: STEP_WIDTH_PX,
      rowHeight: ROW_HEIGHT_PX,
      steps: this.steps(),
      range: this.range(),
    });
    if (!cell || noteAt(this.pattern(), cell.pitch, cell.step)) {
      return;
    }
    this.addAt(cell.pitch, cell.step);
  }

  /** Alternative clavier au clic dans la grille. */
  addFromForm(): void {
    const { pitch, bar, step } = this.addForm.getRawValue();
    if (this.addForm.invalid || bar > this.barCount()) {
      this.message.set(`Choisissez une mesure entre 1 et ${this.barCount()} et un pas entre 1 et ${STEPS_PER_BAR}.`);
      return;
    }
    this.addAt(Number(pitch), (bar - 1) * STEPS_PER_BAR + (step - 1));
  }

  private addAt(pitch: number, step: number): void {
    const result = this.session.addNote(pitch, step, this.noteLength.value);
    if ('error' in result) {
      this.message.set(result.error);
    } else {
      this.message.set(null);
      this.selectedNoteId.set(result.id);
    }
  }

  noteLabel(note: MidiNote): string {
    return describeNote(note);
  }

  /** Position de la note dans la grille (px), en tenant compte de l'aperçu de glissement. */
  noteBox(note: MidiNote): { left: number; top: number; width: number } {
    const preview = this.dragPreview();
    const dragged = preview?.id === note.id ? preview : null;
    const startStep = note.startStep + (dragged?.mode === 'move' ? dragged.steps : 0);
    const pitch = note.pitch + (dragged?.mode === 'move' ? dragged.pitch : 0);
    const duration = Math.max(1, note.durationSteps + (dragged?.mode === 'resize' ? dragged.steps : 0));
    return { left: startStep * STEP_WIDTH_PX, top: (this.range().high - pitch) * ROW_HEIGHT_PX, width: duration * STEP_WIDTH_PX };
  }

  selectNote(note: MidiNote, event?: Event): void {
    event?.stopPropagation();
    this.selectedNoteId.set(note.id);
  }

  /**
   * Clavier, quand une note a le focus : ←/→ déplacer d'un pas (Ctrl : d'un temps),
   * ↑/↓ d'un demi-ton (Ctrl : d'une octave), Maj + ←/→ raccourcir/allonger,
   * + / − vélocité, Suppr supprimer, Échap désélectionner.
   */
  onNoteKey(event: KeyboardEvent, note: MidiNote): void {
    const big = event.ctrlKey || event.metaKey;
    let handled = true;
    this.selectedNoteId.set(note.id);
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        if (event.shiftKey) {
          this.session.resizeNote(note.id, direction);
        } else {
          this.session.moveNote(note.id, direction * (big ? STEPS_PER_BEAT : 1), 0);
        }
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        this.session.moveNote(note.id, 0, (event.key === 'ArrowUp' ? 1 : -1) * (big ? 12 : 1));
        break;
      case '+':
      case '=':
        this.session.setNoteVelocity(note.id, note.velocity + 0.1);
        break;
      case '-':
        this.session.setNoteVelocity(note.id, note.velocity - 0.1);
        break;
      case 'Delete':
      case 'Backspace':
        this.removeSelected();
        break;
      case 'Escape':
        this.selectedNoteId.set(null);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  moveSelected(deltaSteps: number, deltaPitch: number): void {
    const note = this.selectedNote();
    if (note) {
      this.session.moveNote(note.id, deltaSteps, deltaPitch);
    }
  }

  resizeSelected(deltaSteps: number): void {
    const note = this.selectedNote();
    if (note) {
      this.session.resizeNote(note.id, deltaSteps);
    }
  }

  onVelocity(event: Event): void {
    const note = this.selectedNote();
    if (note) {
      this.session.setNoteVelocity(note.id, Number((event.target as HTMLInputElement).value) / 100);
    }
  }

  removeSelected(): void {
    const note = this.selectedNote();
    if (note) {
      this.session.removeNote(note.id);
      this.selectedNoteId.set(null);
    }
  }

  onNotePointerDown(event: PointerEvent, note: MidiNote): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    const resize = (event.target as HTMLElement).classList.contains('resize-handle');
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { note, mode: resize ? 'resize' : 'move', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  }

  onNotePointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    // Aperçu calé sur la grille ; vers le haut = plus aigu.
    this.dragPreview.set({
      id: drag.note.id,
      mode: drag.mode,
      steps: Math.round(dx / STEP_WIDTH_PX),
      pitch: drag.mode === 'move' ? -Math.round(dy / ROW_HEIGHT_PX) : 0,
    });
  }

  onNotePointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const preview = this.dragPreview();
    this.drag = null;
    this.dragPreview.set(null);
    this.selectedNoteId.set(drag.note.id);
    if (!preview) {
      return; // simple clic : sélection
    }
    if (preview.mode === 'resize') {
      this.session.resizeNote(drag.note.id, preview.steps);
    } else {
      this.session.moveNote(drag.note.id, preview.steps, preview.pitch);
    }
  }

  onNotePointerCancel(): void {
    this.drag = null;
    this.dragPreview.set(null);
  }

  formatTone(tone: number): string {
    return `${Math.round(tone * 100)} %`;
  }

  formatRelease(seconds: number): string {
    return `${seconds.toFixed(2).replace('.', ',')} s`;
  }

  private resetPanels(): void {
    this.renaming.set(false);
    this.confirmDelete.set(false);
    this.message.set(null);
    this.selectedNoteId.set(null);
  }
}
