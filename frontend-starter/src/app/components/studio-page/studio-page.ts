import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DrumRackPanelComponent } from '../drum-rack-panel/drum-rack-panel';
import { ExportPanelComponent } from '../export-panel/export-panel';
import { PublishPanelComponent } from '../publish-panel/publish-panel';
import { LyricsPanelComponent } from '../lyrics-panel/lyrics-panel';
import { MixerPanelComponent } from '../mixer-panel/mixer-panel';
import { PianoRollPanelComponent } from '../piano-roll-panel/piano-roll-panel';
import { PitchCorrectionPanelComponent } from '../pitch-correction-panel/pitch-correction-panel';
import { TakesPanelComponent } from '../takes-panel/takes-panel';
import { WaveformComponent } from '../waveform/waveform';
import { AUDIO_FILE_ACCEPT } from '../../shared/audio/audio-file';
import { BEATS_PER_BAR, DEFAULT_BPM, MAX_BPM, MIN_BPM, STEPS_PER_BAR, barsToSeconds } from '../../shared/audio/music-time';
import { InstrumentTrackId } from '../../shared/audio/melodic-pattern';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { isVocalTrackId } from '../../shared/audio/track-mix';
import { TrackMix } from '../../shared/audio/track-mix';
import { layoutClip, dragUnits } from '../../shared/audio/timeline-layout';
import { DEFAULT_LOOP_BARS, MAX_SONG_BARS, describePosition, stepAfterKey, stepFromFraction, validateLoopBars } from '../../shared/audio/timeline-position';
import { StudioProjectService } from '../../shared/services/studio-project.service';
import { LeaveConfirmation } from '../../shared/guards/unsaved-changes.guard';

/** Niveaux de zoom de la timeline, en mesures visibles (du plus proche au plus large). */
const ZOOM_LEVELS = [4, 8, 16, 32] as const;
const DEFAULT_ZOOM_INDEX = 2;
/** La règle affiche 8 repères quel que soit le zoom (grille de fond à 12,5 %). */
const RULER_MARKS = 8;
/** Largeur de la colonne des noms de pistes (styles.css : .track-label, .timeline-ruler). */
const TRACK_LABEL_WIDTH_PX = 150;

type EditorTab = 'Batterie' | 'Piano Roll' | 'Correction vocale' | 'Paroles' | 'Mixeur' | 'Export';

type ClipKind = 'drum' | InstrumentTrackId | 'instrumental' | 'take';

/** Clips qui jouent un pattern en boucle : placés, allongés et dupliqués par mesure. */
function isPatternKind(kind: ClipKind): kind is 'drum' | InstrumentTrackId {
  return kind === 'drum' || kind === 'melody' || kind === 'bass';
}

/** Clip affiché sur la timeline (position en % de la fenêtre visible). */
interface TimelineClip {
  readonly kind: ClipKind;
  readonly id: string;
  readonly label: string;
  /** Description pour les lecteurs d'écran : nature, position et commandes. */
  readonly ariaLabel: string;
  readonly left: number;
  readonly width: number;
  readonly pattern: 'note' | 'wave';
  /** Fichier à dessiner et fin de la portion visible (secondes), pour un clip audio. */
  readonly waveform?: { readonly buffer: AudioBuffer; readonly toSeconds: number };
}

interface TimelineTrack extends StudioTrackInfo {
  readonly clips: readonly TimelineClip[];
  readonly mix: TrackMix;
}

/** Glissement en cours d'un clip (souris, doigt ou stylet). */
interface ClipDrag {
  readonly clip: TimelineClip;
  readonly pointerId: number;
  readonly startX: number;
  readonly laneWidth: number;
}

/** Seuil en pixels au-delà duquel un appui devient un glissement (sinon c'est un clic). */
const DRAG_THRESHOLD_PX = 4;

/**
 * Page Studio : assemble le transport, la timeline et les panneaux d'édition.
 * L'état audio vit dans `StudioSessionService`, fourni ici pour qu'il soit libéré
 * (micro, sources, ObjectURL) à la sortie du studio. Avec un identifiant dans l'URL
 * (`/studio/:id`), `StudioProjectService` charge et sauvegarde le projet.
 */
@Component({
  selector: 'app-studio-page',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    DrumRackPanelComponent,
    ExportPanelComponent,
    LyricsPanelComponent,
    MixerPanelComponent,
    PianoRollPanelComponent,
    PitchCorrectionPanelComponent,
    PublishPanelComponent,
    TakesPanelComponent,
    WaveformComponent,
  ],
  providers: [StudioSessionService, StudioProjectService],
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '(window:keydown)': 'onKeydown($event)',
  },
  templateUrl: './studio-page.html',
  styleUrl: './studio-page.css',
})
export class StudioPageComponent implements LeaveConfirmation {
  readonly session = inject(StudioSessionService);
  readonly studioProject = inject(StudioProjectService);
  /** Identifiant du projet ouvert, ou `null` pour la session libre de `/studio`. */
  readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  readonly editorTabs: readonly EditorTab[] = ['Batterie', 'Piano Roll', 'Correction vocale', 'Paroles', 'Mixeur', 'Export'];
  readonly activeTab = signal<EditorTab>('Batterie');
  /** Panneau « Publier le son » (#80), ouvert depuis l'en-tête d'un projet sauvegardé. */
  readonly publishOpen = signal(false);

  /** Depuis une piste Mélodie ou Basse vide : ouvre le Piano Roll avec le choix d'instrument. */
  openInstrumentPicker(event: Event): void {
    // Le clic ne doit pas aussi déplacer la tête de lecture (gestionnaire de la piste).
    event.stopPropagation();
    this.session.instrumentPickerOpen.set(true);
    this.activeTab.set('Piano Roll');
  }
  readonly audioAccept = AUDIO_FILE_ACCEPT;
  readonly minBpm = MIN_BPM;
  readonly maxBpm = MAX_BPM;
  readonly instruments = [
    { name: 'Drum machine', type: 'Rythme & percussions', icon: '▦' },
    { name: 'Piano', type: 'Piano Roll · accords et mélodies', icon: '♬' },
    { name: 'Synthé', type: 'Piano Roll · nappes et leads', icon: '∿' },
    { name: 'Basse 808', type: 'Piano Roll · basse jouée par notes', icon: '≋' },
    { name: 'Microphone', type: 'Voix & prises', icon: '♩' },
  ];

  readonly maxSongBars = MAX_SONG_BARS;
  readonly loopFrom = new FormControl(DEFAULT_LOOP_BARS.fromBar, { nonNullable: true });
  readonly loopTo = new FormControl(DEFAULT_LOOP_BARS.toBar, { nonNullable: true });
  readonly loopError = signal<string | null>(null);
  /** Position de la tête de lecture, lisible par un lecteur d'écran. */
  readonly positionText = computed(() => describePosition(this.session.songStep()));
  /** Plage de boucle en % de la fenêtre visible, ou `null` si la boucle est coupée ou hors champ. */
  readonly loopBand = computed(() => {
    const range = this.session.loopRange();
    if (!range) {
      return null;
    }
    const visibleSteps = this.visibleBars() * STEPS_PER_BAR;
    const left = (100 * range.startStep) / visibleSteps;
    if (left >= 100) {
      return null;
    }
    return { left, width: Math.min(100 - left, (100 * (range.endStep - range.startStep)) / visibleSteps) };
  });

  readonly bpmControl = new FormControl(DEFAULT_BPM, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(MIN_BPM), Validators.max(MAX_BPM)],
  });

  private readonly zoomIndex = signal(DEFAULT_ZOOM_INDEX);
  readonly visibleBars = computed(() => ZOOM_LEVELS[this.zoomIndex()]);
  readonly canZoomIn = computed(() => this.zoomIndex() > 0);
  readonly canZoomOut = computed(() => this.zoomIndex() < ZOOM_LEVELS.length - 1);
  /** Numéros de mesure affichés sur la règle (8 repères répartis sur la fenêtre visible). */
  readonly rulerBars = computed(() => {
    const barsPerMark = this.visibleBars() / RULER_MARKS;
    return Array.from({ length: RULER_MARKS }, (_, index) => index * barsPerMark + 1);
  });
  /** Tête de lecture en % de la fenêtre visible, ou `null` si elle est hors champ ou à l'arrêt. */
  readonly playheadPercent = computed(() => {
    if (this.session.transportState() === 'stopped') {
      return null;
    }
    const percent = (100 * this.session.songStep()) / (this.visibleBars() * STEPS_PER_BAR);
    return percent <= 100 ? percent : null;
  });

  /** Clip sélectionné pour l'édition (barre d'outils, clavier). */
  readonly selectedClip = signal<{ readonly kind: ClipKind; readonly id: string } | null>(null);
  /** Aperçu du glissement en cours : décalage en % appliqué au clip saisi. */
  readonly dragPreview = signal<{ readonly id: string; readonly offsetPercent: number } | null>(null);
  private drag: ClipDrag | null = null;

  /** Pistes réelles de la session, placées sur la fenêtre visible de la timeline. */
  readonly tracks = computed<TimelineTrack[]>(() => {
    const bpm = this.session.bpm();
    const visibleSeconds = barsToSeconds(this.visibleBars(), bpm);
    const barSeconds = barsToSeconds(1, bpm);
    const instrumental = this.session.instrumental();
    const mixer = this.session.mixer();
    return this.session.studioTracks().map(info => {
      const clips: TimelineClip[] = [];
      const take = isVocalTrackId(info.id) ? this.session.activeTakeFor(info.id) : null;
      if (info.id === 'melody' || info.id === 'bass') {
        const names = new Map(this.session.melodicPatterns().map(entry => [entry.id, entry.name]));
        for (const clip of this.session.instrumentClips()[info.id]) {
          const box = layoutClip(clip.startBar * barSeconds, clip.lengthBars * barSeconds, visibleSeconds);
          if (box) {
            const range = clip.lengthBars > 1 ? `mesures ${clip.startBar + 1} à ${clip.startBar + clip.lengthBars}` : `mesure ${clip.startBar + 1}`;
            const name = names.get(clip.patternId) ?? 'Pattern';
            clips.push({ kind: info.id, id: clip.id, label: `${name} · ${clip.lengthBars} mes.`, ariaLabel: `Clip ${info.name} ${name}, ${range}`, ...box, pattern: 'note' });
          }
        }
      } else if (info.id === 'drums') {
        const names = new Map(this.session.patterns().map(entry => [entry.id, entry.name]));
        for (const clip of this.session.drumClips()) {
          const box = layoutClip(clip.startBar * barSeconds, clip.lengthBars * barSeconds, visibleSeconds);
          if (box) {
            const range = clip.lengthBars > 1 ? `mesures ${clip.startBar + 1} à ${clip.startBar + clip.lengthBars}` : `mesure ${clip.startBar + 1}`;
            const name = names.get(clip.patternId) ?? 'Pattern';
            clips.push({ kind: 'drum', id: clip.id, label: `${name} · ${clip.lengthBars} mes.`, ariaLabel: `Clip de batterie ${name}, ${range}`, ...box, pattern: 'note' });
          }
        }
      } else if (info.id === 'instrumental' && instrumental) {
        const start = this.session.instrumentalStartSeconds();
        const box = layoutClip(start, instrumental.buffer.duration, visibleSeconds);
        if (box) {
          clips.push({
            kind: 'instrumental',
            id: 'instrumental',
            label: instrumental.name,
            ariaLabel: `Instrumentale ${instrumental.name}, début ${describePosition(Math.round((start / barSeconds) * STEPS_PER_BAR))}`,
            ...box,
            pattern: 'wave',
            waveform: { buffer: instrumental.buffer, toSeconds: Math.max(0.01, Math.min(instrumental.buffer.duration, visibleSeconds - start)) },
          });
        }
      } else if (take) {
        const box = layoutClip(take.startSeconds, take.buffer.duration, visibleSeconds);
        if (box) {
          const visibleTakeSeconds = Math.max(0.01, Math.min(take.buffer.duration, visibleSeconds - Math.max(0, take.startSeconds)));
          clips.push({
            kind: 'take',
            id: take.id,
            label: take.name,
            ariaLabel: `Prise ${take.name}, début ${take.startSeconds.toFixed(2).replace('.', ',')} s`,
            ...box,
            pattern: 'wave',
            waveform: { buffer: take.buffer, toSeconds: visibleTakeSeconds },
          });
        }
      }
      return { ...info, clips, mix: mixer[info.id] };
    });
  });

  /** Clip sélectionné tel qu'affiché, ou `null` s'il n'existe plus ou est hors champ. */
  readonly selection = computed(() => {
    const selected = this.selectedClip();
    if (!selected) {
      return null;
    }
    for (const track of this.tracks()) {
      const clip = track.clips.find(candidate => candidate.kind === selected.kind && candidate.id === selected.id);
      if (clip) {
        return clip;
      }
    }
    return null;
  });

  constructor() {
    this.bpmControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.session.setBpm(value));
    if (this.projectId) {
      this.studioProject.load(this.projectId);
    }
    // Le champ BPM reflète le tempo chargé depuis le projet, sans renvoyer d'événement.
    effect(() => {
      const bpm = this.session.bpm();
      if (this.bpmControl.value !== bpm && this.bpmControl.valid) {
        this.bpmControl.setValue(bpm, { emitEvent: false });
      }
    });
  }

  /** Clic sur la règle ou sur une piste : la tête de lecture se place au temps le plus proche. */
  onTimelineClick(event: MouseEvent): void {
    const lane = (event.currentTarget as HTMLElement).closest('.timeline-inner')?.querySelector('.track-lane');
    if (!lane) {
      return;
    }
    const rect = lane.getBoundingClientRect();
    if (event.clientX < rect.left) {
      return; // clic sur la colonne des noms de pistes
    }
    void this.session.seek(stepFromFraction((event.clientX - rect.left) / rect.width, this.visibleBars()));
  }

  /** Alternative clavier au clic : la règle est un curseur (flèches, Page, Début, Fin). */
  onRulerKey(event: KeyboardEvent): void {
    const step = stepAfterKey(this.session.songStep(), event.key, this.session.songEndStep());
    if (step !== null) {
      event.preventDefault();
      void this.session.seek(step);
    }
  }

  /** La règle commence par la colonne des noms de pistes (150 px) : les % portent sur le reste. */
  rulerOffset(percent: number): string {
    return `calc(${TRACK_LABEL_WIDTH_PX}px + (100% - ${TRACK_LABEL_WIDTH_PX}px) * ${percent / 100})`;
  }

  rulerWidth(percent: number): string {
    return `calc((100% - ${TRACK_LABEL_WIDTH_PX}px) * ${percent / 100})`;
  }

  toggleLoop(event: Event): void {
    void this.session.setLoop({ enabled: (event.target as HTMLInputElement).checked });
  }

  onLoopBarsChange(): void {
    const bars = { fromBar: Number(this.loopFrom.value), toBar: Number(this.loopTo.value) };
    const error = validateLoopBars(bars);
    this.loopError.set(error);
    if (!error) {
      void this.session.setLoop({ bars });
    }
  }

  // ——— Édition des clips (M5) ———

  selectClip(clip: TimelineClip, event?: Event): void {
    event?.stopPropagation(); // un clic sur un clip ne déplace pas la tête de lecture
    this.selectedClip.set({ kind: clip.kind, id: clip.id });
  }

  /**
   * Déplace un clip : batterie par mesure ; instrumentale et prise par temps.
   * `units` : nombre de mesures (batterie) ou de temps (audio).
   */
  moveClip(clip: TimelineClip, units: number): void {
    if (units === 0) {
      return;
    }
    if (clip.kind === 'drum') {
      this.session.moveDrumClip(clip.id, units);
    } else if (clip.kind === 'melody' || clip.kind === 'bass') {
      this.session.moveInstrumentClip(clip.kind, clip.id, units);
    } else if (clip.kind === 'instrumental') {
      this.session.moveInstrumental(units);
    } else {
      this.session.moveTake(clip.id, units);
    }
  }

  readonly isPatternClip = (clip: TimelineClip) => isPatternKind(clip.kind);

  duplicateSelected(): void {
    const clip = this.selection();
    if (!clip || !isPatternKind(clip.kind)) {
      return;
    }
    const copy = clip.kind === 'drum' ? this.session.duplicateDrumClip(clip.id) : this.session.duplicateInstrumentClip(clip.kind, clip.id);
    if (copy) {
      this.selectedClip.set({ kind: clip.kind, id: copy });
    }
  }

  /** Pattern joué par le clip sélectionné (batterie, mélodie ou basse). */
  readonly selectedPatternId = computed(() => {
    const selected = this.selectedClip();
    if (!selected || !isPatternKind(selected.kind)) {
      return null;
    }
    const clips = selected.kind === 'drum' ? this.session.drumClips() : this.session.instrumentClips()[selected.kind];
    return clips.find(clip => clip.id === selected.id)?.patternId ?? null;
  });

  /** Patterns proposés pour le clip sélectionné : batterie, ou patterns du Piano Roll. */
  readonly selectablePatterns = computed<readonly { id: string; name: string }[]>(() => {
    const selected = this.selectedClip();
    return selected?.kind === 'drum' ? this.session.patterns() : this.session.melodicPatterns();
  });

  onClipPatternChange(event: Event): void {
    const clip = this.selection();
    const patternId = (event.target as HTMLSelectElement).value;
    if (clip?.kind === 'drum') {
      this.session.setDrumClipPattern(clip.id, patternId);
    } else if (clip?.kind === 'melody' || clip?.kind === 'bass') {
      this.session.setInstrumentClipPattern(clip.kind, clip.id, patternId);
    }
  }

  resizeSelected(deltaBars: number): void {
    const clip = this.selection();
    if (clip?.kind === 'drum') {
      this.session.resizeDrumClip(clip.id, deltaBars);
    } else if (clip?.kind === 'melody' || clip?.kind === 'bass') {
      this.session.resizeInstrumentClip(clip.kind, clip.id, deltaBars);
    }
  }

  deleteSelected(): void {
    const clip = this.selection();
    if (clip?.kind === 'drum') {
      this.session.removeDrumClip(clip.id);
    } else if (clip?.kind === 'melody' || clip?.kind === 'bass') {
      this.session.removeInstrumentClip(clip.kind, clip.id);
    } else {
      return;
    }
    this.selectedClip.set(null);
  }

  addDrumClip(): void {
    const id = this.session.addDrumClipAtPlayhead();
    if (id) {
      this.selectedClip.set({ kind: 'drum', id });
    }
  }

  /**
   * Alternative clavier au glisser-déposer, quand un clip a le focus :
   * flèches = déplacer (Maj : d'une mesure pour l'audio), Suppr = supprimer un clip de pattern,
   * Ctrl/Cmd + D = dupliquer, Échap = désélectionner.
   */
  onClipKey(event: KeyboardEvent, clip: TimelineClip): void {
    const step = isPatternKind(clip.kind) ? 1 : event.shiftKey ? BEATS_PER_BAR : 1;
    let handled = true;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.selectClip(clip);
      this.moveClip(clip, event.key === 'ArrowLeft' ? -step : step);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && isPatternKind(clip.kind)) {
      this.selectClip(clip);
      this.deleteSelected();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && isPatternKind(clip.kind)) {
      this.selectClip(clip);
      this.duplicateSelected();
    } else if (event.key === 'Escape') {
      this.selectedClip.set(null);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onClipPointerDown(event: PointerEvent, clip: TimelineClip): void {
    if (event.button !== 0) {
      return;
    }
    const lane = (event.currentTarget as HTMLElement).closest('.track-lane');
    if (!lane) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { clip, pointerId: event.pointerId, startX: event.clientX, laneWidth: lane.getBoundingClientRect().width };
  }

  onClipPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) >= DRAG_THRESHOLD_PX) {
      // Aperçu calé sur la grille : le clip saute de mesure en mesure (ou de temps en temps).
      const units = dragUnits(delta, drag.laneWidth, this.unitsInWindow(drag.clip));
      this.dragPreview.set({ id: drag.clip.id, offsetPercent: (100 * units) / this.unitsInWindow(drag.clip) });
    }
  }

  onClipPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    this.drag = null;
    this.dragPreview.set(null);
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) >= DRAG_THRESHOLD_PX) {
      this.selectedClip.set({ kind: drag.clip.kind, id: drag.clip.id });
      this.moveClip(drag.clip, dragUnits(delta, drag.laneWidth, this.unitsInWindow(drag.clip)));
    }
  }

  onClipPointerCancel(): void {
    this.drag = null;
    this.dragPreview.set(null);
  }

  /** Nombre de mesures (patterns) ou de temps (audio) contenus dans la fenêtre visible. */
  private unitsInWindow(clip: TimelineClip): number {
    return isPatternKind(clip.kind) ? this.visibleBars() : this.visibleBars() * BEATS_PER_BAR;
  }

  onAutoSaveChange(event: Event): void {
    this.studioProject.autoSave.set((event.target as HTMLInputElement).checked);
  }

  /** Utilisé par `unsavedChangesGuard` avant de quitter le studio. */
  canLeave(): boolean {
    if (this.studioProject.uploading()) {
      return confirm('Un fichier audio est en cours d’envoi. Quitter interrompt l’envoi. Quitter quand même ?');
    }
    return !this.studioProject.hasUnsavedChanges() || confirm('Des modifications ne sont pas sauvegardées. Quitter quand même ?');
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.studioProject.hasUnsavedChanges() || this.studioProject.uploading()) {
      event.preventDefault();
    }
  }

  /** Ctrl+S / Cmd+S sauvegarde le projet, y compris depuis un champ (le raccourci n'y écrit rien). */
  onKeydown(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 's' && this.studioProject.project()) {
      event.preventDefault();
      this.studioProject.save();
      return;
    }
    // Annuler / Rétablir : laissés au champ de saisie qui a le focus (annulation de texte).
    const target = event.target as HTMLElement | null;
    const typing = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    if (!modifier || typing) {
      return;
    }
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.session.undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      this.session.redo();
    }
  }

  toggleRecording(): void {
    // L'arrêt passe par le projet : la nouvelle prise y est aussitôt envoyée.
    if (this.session.micState() === 'recording') {
      void this.studioProject.stopRecording();
    } else if (this.studioProject.takesLoading() === 0) {
      void this.session.startRecording();
    }
  }

  zoom(direction: 'in' | 'out'): void {
    this.zoomIndex.update(index => Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + (direction === 'in' ? -1 : 1))));
  }

  onInstrumentalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.studioProject.importInstrumental(file);
    }
  }

  /** Niveau du micro en dBFS pour le lecteur d'écran (le compteur visuel est linéaire). */
  levelText(): string {
    const { rms, clipping } = this.session.inputLevel();
    const db = rms > 0 ? Math.round(20 * Math.log10(rms)) : null;
    return `${db === null ? 'silence' : `${db} dB`}${clipping ? ', saturation' : ''}`;
  }

  formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
  }

  pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
