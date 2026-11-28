import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
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
import { PasteResult, copyNotes, notesInBox, notesSpan } from '../../shared/audio/note-selection';
import { InstrumentPickerComponent } from '../instrument-picker/instrument-picker';

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
  /** Notes déplacées ensemble (la sélection au moment de l'appui). */
  readonly ids: ReadonlySet<string>;
  readonly mode: 'move' | 'resize';
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
}

/** Début d'un rectangle de sélection (pixels dans la grille). */
interface LassoStart {
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
  /** Ctrl ou Maj : le rectangle ajoute à la sélection au lieu de la remplacer. */
  readonly additive: boolean;
}

/**
 * Piano Roll (M4) : hauteur en vertical (aigus en haut), temps en horizontal (pas de
 * double-croche). Le pattern affiché est celui que l'on modifie ; chaque clip des pistes
 * Mélodie et Basse joue le sien. La logique des notes vit dans `melodic-pattern.ts`.
 */
@Component({
  selector: 'app-piano-roll-panel',
  imports: [ReactiveFormsModule, InstrumentPickerComponent],
  templateUrl: './piano-roll-panel.html',
  styleUrl: './piano-roll-panel.css',
})
export class PianoRollPanelComponent {
  readonly session = inject(StudioSessionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

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
  readonly track = computed(() => this.session.instrumentTarget(this.pattern().instrument));
  readonly trackLabel = computed(() => this.session.instrumentTracks().find(track => track.id === this.track())?.name ?? 'Instrument');
  readonly pickerDestination = computed(() => {
    const target = this.session.instrumentPickerTarget();
    if (target === 'new') return 'à créer';
    if (target === 'default') return this.session.selectedInstrumentTrack()?.name ?? null;
    return this.session.instrumentTracks().find(track => track.id === target)?.name ?? null;
  });
  readonly usage = computed(() => instrumentClipsUsing(this.session.instrumentClips(), this.pattern().id));
  readonly patternCount = computed(() => this.session.patterns().length + this.session.melodicPatterns().length);
  readonly auditioning = computed(() => this.session.auditionPatternId() === this.pattern().id && this.session.playing());

  /** Notes sélectionnées (identifiants). Les actions d'édition s'appliquent à toutes. */
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedNotes = computed(() => this.pattern().notes.filter(note => this.selectedIds().has(note.id)));
  /** La note sélectionnée quand il n'y en a qu'une (nom affiché dans la barre). */
  readonly selectedNote = computed(() => (this.selectedNotes().length === 1 ? this.selectedNotes()[0] : null));
  readonly hasClipboard = computed(() => this.session.noteClipboard() !== null);
  /** Aperçu du glissement : décalage en pas et en demi-tons de toute la sélection, ou allongement en pas. */
  readonly dragPreview = signal<{ readonly ids: ReadonlySet<string>; readonly steps: number; readonly pitch: number; readonly mode: 'move' | 'resize' } | null>(null);
  /** Rectangle de sélection en cours, en pixels dans la grille. */
  readonly lasso = signal<{ readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null>(null);
  private drag: NoteDrag | null = null;
  private lassoStart: LassoStart | null = null;
  /** Le clic qui suit un rectangle de sélection ne doit pas poser de note. */
  private skipNextGridClick = false;
  /** Pas où coller sans sélection : la place d'origine du bloc copié. */
  private copiedFromStep = 0;

  readonly message = signal<string | null>(null);
  /** Confirmation affichée après l'ajout d'un instrument (distincte des erreurs). */
  readonly notice = signal<string | null>(null);
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

  /** Ajoute l'instrument choisi : nouvelle partie ouverte ici et placée sur sa piste. */
  addInstrument(instrument: InstrumentId): void {
    this.resetPanels();
    const target = this.session.instrumentPickerTarget() ?? 'default';
    if (target === 'new' && !this.session.canAddTrack()) {
      this.message.set('Le projet a atteint la limite de pistes. Supprimez une piste pour en ajouter une.');
      return;
    }
    if (target === 'new' && this.session.micState() !== 'idle') {
      this.message.set('Terminez la prise vocale avant d’ajouter une piste.');
      return;
    }
    const result = this.session.addInstrument(instrument, target);
    if (!result) {
      this.message.set(`${MAX_PATTERNS} patterns maximum (batterie et instruments) : supprimez-en un pour ajouter un instrument.`);
      return;
    }
    this.session.instrumentPickerTarget.set(null);
    const trackName = this.trackLabel();
    const bar = result.startBar + 1;
    this.notice.set(
      result.clipId
        ? `Instrument ajouté : ${INSTRUMENT_LABELS[instrument]}, sur la piste ${trackName} à la mesure ${bar}. Cliquez dans la grille ci-dessous pour poser des notes.`
        : `Partie créée pour : ${INSTRUMENT_LABELS[instrument]}, mais la piste ${trackName} est pleine : supprimez un clip puis « Placer sur la piste ».`,
    );
  }

  togglePicker(): void {
    this.resetPanels();
    this.session.instrumentPickerTarget.update(target => target === null ? 'default' : null);
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
    if (this.skipNextGridClick) {
      this.skipNextGridClick = false;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
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
      this.selectOnly(result.id);
    }
  }

  noteLabel(note: MidiNote): string {
    return describeNote(note);
  }

  isSelected(note: MidiNote): boolean {
    return this.selectedIds().has(note.id);
  }

  /** Position de la note dans la grille (px), en tenant compte de l'aperçu de glissement. */
  noteBox(note: MidiNote): { left: number; top: number; width: number } {
    const preview = this.dragPreview();
    const dragged = preview?.ids.has(note.id) ? preview : null;
    const startStep = note.startStep + (dragged?.mode === 'move' ? dragged.steps : 0);
    const pitch = note.pitch + (dragged?.mode === 'move' ? dragged.pitch : 0);
    const duration = Math.max(1, note.durationSteps + (dragged?.mode === 'resize' ? dragged.steps : 0));
    return { left: startStep * STEP_WIDTH_PX, top: (this.range().high - pitch) * ROW_HEIGHT_PX, width: duration * STEP_WIDTH_PX };
  }

  // ——— Sélection ———

  selectOnly(id: string): void {
    this.selectedIds.set(new Set([id]));
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  selectAll(): void {
    this.selectedIds.set(new Set(this.pattern().notes.map(note => note.id)));
  }

  private toggleInSelection(id: string): void {
    this.selectedIds.update(current => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** Clic sur une note. Au clavier (Entrée, Espace), la note devient la seule sélectionnée. */
  onNoteClick(note: MidiNote, event: MouseEvent): void {
    event.stopPropagation();
    if (event.detail === 0) {
      this.selectOnly(note.id);
    }
  }

  /** Sans sélection, la note qui a le focus devient la sélection (Tab puis flèches). */
  onNoteKeydown(note: MidiNote): void {
    if (this.selectedIds().size === 0) {
      this.selectOnly(note.id);
    }
  }

  /**
   * Raccourcis du Piano Roll, quand une note ou la grille a le focus : Ctrl + A/C/X/V/D,
   * Suppr, flèches (Ctrl : un temps ou une octave), Maj + ←/→ longueur, + / − vélocité, Échap.
   */
  onRollKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).closest('input, select, textarea')) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    let handled = true;
    if (command && !event.altKey) {
      switch (event.key.toLowerCase()) {
        case 'a':
          this.selectAll();
          break;
        case 'c':
          this.copySelection();
          break;
        case 'x':
          this.cutSelection();
          break;
        case 'v':
          this.paste();
          break;
        case 'd':
          this.duplicateSelection();
          break;
        case 'arrowleft':
        case 'arrowright':
          this.moveSelected((event.key === 'ArrowLeft' ? -1 : 1) * STEPS_PER_BEAT, 0);
          break;
        case 'arrowup':
        case 'arrowdown':
          this.moveSelected(0, event.key === 'ArrowUp' ? 12 : -12);
          break;
        default:
          handled = false;
      }
    } else {
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          if (event.shiftKey) {
            this.resizeSelected(direction);
          } else {
            this.moveSelected(direction, 0);
          }
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown':
          this.moveSelected(0, event.key === 'ArrowUp' ? 1 : -1);
          break;
        case '+':
        case '=':
          this.session.shiftNotesVelocity(this.selectedIds(), 0.1);
          break;
        case '-':
          this.session.shiftNotesVelocity(this.selectedIds(), -0.1);
          break;
        case 'Delete':
        case 'Backspace':
          this.removeSelected();
          break;
        case 'Escape':
          this.clearSelection();
          break;
        default:
          handled = false;
      }
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  moveSelected(deltaSteps: number, deltaPitch: number): void {
    const ids = this.selectedIds();
    if (ids.size === 0) {
      return;
    }
    const before = this.pattern();
    this.session.moveNotes(ids, deltaSteps, deltaPitch);
    if (this.pattern() === before) {
      this.message.set('Déplacement impossible : la sélection recouvrirait une autre note, ou est déjà au bord du pattern.');
      return;
    }
    this.message.set(null);
    if (deltaPitch !== 0 && ids.size === 1) {
      void this.session.previewNote(this.selectedNotes()[0].pitch);
    }
  }

  resizeSelected(deltaSteps: number): void {
    this.session.resizeNotes(this.selectedIds(), deltaSteps);
  }

  onVelocity(event: Event): void {
    this.session.setNotesVelocity(this.selectedIds(), Number((event.target as HTMLInputElement).value) / 100);
  }

  removeSelected(): void {
    const ids = this.selectedIds();
    if (ids.size > 0) {
      this.session.removeNotes(ids);
      this.clearSelection();
      // La note qui avait le focus a disparu : la grille le reprend pour garder les raccourcis.
      this.host.nativeElement.querySelector<HTMLElement>('.roll-scroll')?.focus({ preventScroll: true });
    }
  }

  // ——— Copier, couper, coller, dupliquer ———

  copySelection(): void {
    const span = notesSpan(this.selectedNotes());
    const count = this.session.copyNotes(this.selectedIds());
    if (!span || count === 0) {
      this.message.set('Sélectionnez d’abord des notes à copier (clic, Ctrl + clic ou rectangle).');
      return;
    }
    this.copiedFromStep = span.start;
    this.message.set(null);
    this.notice.set(`${count} note${count > 1 ? 's' : ''} copiée${count > 1 ? 's' : ''}. Ctrl + V colle juste après la sélection, ou à la même place si rien n’est sélectionné.`);
  }

  cutSelection(): void {
    if (this.selectedIds().size === 0) {
      this.message.set('Sélectionnez d’abord des notes à couper.');
      return;
    }
    this.copySelection();
    this.removeSelected();
  }

  /** Colle juste après la sélection ; sans sélection, à la place d'origine du bloc copié. */
  paste(): void {
    const span = notesSpan(this.selectedNotes());
    this.applyPaste(this.session.pasteNotes(span ? span.end : this.copiedFromStep), 'coller');
  }

  /** Recopie la sélection juste après elle, sans toucher au presse-papiers. */
  duplicateSelection(): void {
    const span = notesSpan(this.selectedNotes());
    const block = copyNotes(this.pattern(), this.selectedIds());
    if (!span || !block) {
      this.message.set('Sélectionnez d’abord des notes à dupliquer.');
      return;
    }
    this.applyPaste(this.session.pasteNotes(span.end, block), 'dupliquer');
  }

  private applyPaste(result: PasteResult | null, verb: string): void {
    if (!result) {
      this.message.set('Rien à coller : copiez d’abord des notes (Ctrl + C).');
      return;
    }
    if (result.ids.length === 0) {
      this.message.set(`Impossible de ${verb} : plus de place à cet endroit du pattern (allongez-le ou sélectionnez plus tôt).`);
      return;
    }
    this.selectedIds.set(new Set(result.ids));
    this.focusNote(result.ids[0]);
    const skipped = result.skipped;
    this.message.set(skipped > 0 ? `${skipped} note${skipped > 1 ? 's' : ''} ignorée${skipped > 1 ? 's' : ''} : hors du pattern ou sur une note existante.` : null);
  }

  /** Le focus suit les notes collées : les raccourcis suivants s'appliquent à elles. */
  private focusNote(id: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-note-id="${id}"]`)?.focus({ preventScroll: true }), { injector: this.injector });
  }

  // ——— Souris : glisser des notes, rectangle de sélection ———

  onNotePointerDown(event: PointerEvent, note: MidiNote): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.toggleInSelection(note.id);
      return;
    }
    if (!this.selectedIds().has(note.id)) {
      this.selectOnly(note.id);
    }
    const resize = (event.target as HTMLElement).classList.contains('resize-handle');
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { note, ids: this.selectedIds(), mode: resize ? 'resize' : 'move', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
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
      ids: drag.ids,
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
    if (!preview) {
      // Simple clic sur une note d'une sélection multiple : elle devient la seule sélectionnée.
      this.selectOnly(drag.note.id);
      return;
    }
    if (preview.mode === 'resize') {
      this.session.resizeNotes(drag.ids, preview.steps);
    } else {
      this.moveSelected(preview.steps, preview.pitch);
    }
  }

  onNotePointerCancel(): void {
    this.drag = null;
    this.dragPreview.set(null);
  }

  /** Appui sur une case vide : début possible d'un rectangle de sélection. */
  onGridPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.note')) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.lassoStart = { x: event.clientX - rect.left, y: event.clientY - rect.top, pointerId: event.pointerId, additive: event.ctrlKey || event.metaKey || event.shiftKey };
  }

  onGridPointerMove(event: PointerEvent): void {
    const start = this.lassoStart;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    const grid = event.currentTarget as HTMLElement;
    const rect = grid.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!this.lasso()) {
      if (Math.abs(x - start.x) < DRAG_THRESHOLD_PX && Math.abs(y - start.y) < DRAG_THRESHOLD_PX) {
        return;
      }
      grid.setPointerCapture?.(event.pointerId);
    }
    this.lasso.set({ left: Math.min(x, start.x), top: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
  }

  onGridPointerUp(event: PointerEvent): void {
    const start = this.lassoStart;
    const box = this.lasso();
    this.lassoStart = null;
    this.lasso.set(null);
    if (!start || !box || start.pointerId !== event.pointerId) {
      return;
    }
    this.skipNextGridClick = true;
    const { high } = this.range();
    const found = notesInBox(
      this.pattern(),
      Math.floor(box.left / STEP_WIDTH_PX),
      Math.floor((box.left + box.width) / STEP_WIDTH_PX),
      high - Math.floor((box.top + box.height) / ROW_HEIGHT_PX),
      high - Math.floor(box.top / ROW_HEIGHT_PX),
    );
    this.selectedIds.update(current => new Set(start.additive ? [...current, ...found] : found));
  }

  onGridPointerCancel(): void {
    this.lassoStart = null;
    this.lasso.set(null);
  }

  formatTone(tone: number): string {
    return `${Math.round(tone * 100)} %`;
  }

  formatRelease(seconds: number): string {
    return `${seconds.toFixed(2).replace('.', ',')} s`;
  }

  private resetPanels(): void {
    this.notice.set(null);
    this.renaming.set(false);
    this.confirmDelete.set(false);
    this.message.set(null);
    this.clearSelection();
  }
}
