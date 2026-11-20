import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DrumRackPanelComponent } from '../drum-rack-panel/drum-rack-panel';
import { ExportPanelComponent } from '../export-panel/export-panel';
import { MixerPanelComponent } from '../mixer-panel/mixer-panel';
import { PitchCorrectionPanelComponent } from '../pitch-correction-panel/pitch-correction-panel';
import { TakesPanelComponent } from '../takes-panel/takes-panel';
import { WaveformComponent } from '../waveform/waveform';
import { AUDIO_FILE_ACCEPT } from '../../shared/audio/audio-file';
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, STEPS_PER_BAR, barsToSeconds } from '../../shared/audio/music-time';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { STUDIO_TRACKS, StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { TrackMix } from '../../shared/audio/track-mix';
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

type EditorTab = 'Batterie' | 'Correction vocale' | 'Mixeur' | 'Export';

interface TimelineTrack extends StudioTrackInfo {
  /** `null` : piste vide, rien à afficher dans la ligne. */
  readonly clip: {
    readonly label: string;
    readonly offset: number;
    readonly width: number;
    readonly pattern: 'note' | 'wave';
    /** Fichier à dessiner et fin de la portion visible (secondes), pour l'instrumentale. */
    readonly waveform?: { readonly buffer: AudioBuffer; readonly toSeconds: number };
  } | null;
  readonly mix: TrackMix;
}

/**
 * Page Studio : assemble le transport, la timeline et les panneaux d'édition.
 * L'état audio vit dans `StudioSessionService`, fourni ici pour qu'il soit libéré
 * (micro, sources, ObjectURL) à la sortie du studio. Avec un identifiant dans l'URL
 * (`/studio/:id`), `StudioProjectService` charge et sauvegarde le projet.
 */
@Component({
  selector: 'app-studio-page',
  imports: [RouterLink, ReactiveFormsModule, DrumRackPanelComponent, ExportPanelComponent, MixerPanelComponent, PitchCorrectionPanelComponent, TakesPanelComponent, WaveformComponent],
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

  readonly editorTabs: readonly EditorTab[] = ['Batterie', 'Correction vocale', 'Mixeur', 'Export'];
  readonly activeTab = signal<EditorTab>('Batterie');
  readonly audioAccept = AUDIO_FILE_ACCEPT;
  readonly minBpm = MIN_BPM;
  readonly maxBpm = MAX_BPM;
  readonly instruments = [{ name: 'Drum machine', type: 'Rythme & percussions', icon: '▦' }, { name: '808 Bass', type: 'Basse & sub', icon: '≋' }, { name: 'Soft keys', type: 'Piano & claviers', icon: '♬' }, { name: 'Microphone', type: 'Voix & prises', icon: '♩' }];

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

  /** Pistes réelles de la session, placées sur la fenêtre visible de la timeline. */
  readonly tracks = computed<TimelineTrack[]>(() => {
    const visibleSeconds = barsToSeconds(this.visibleBars(), this.session.bpm());
    const percent = (seconds: number) => Math.min(100, (100 * seconds) / visibleSeconds);
    const instrumental = this.session.instrumental();
    const take = this.session.take();
    const mixer = this.session.mixer();
    return STUDIO_TRACKS.map(info => {
      let clip: TimelineTrack['clip'] = null;
      if (info.id === 'drums') {
        clip = { label: 'Pattern 01 · boucle 1 mesure', offset: 0, width: 100, pattern: 'note' };
      } else if (info.id === 'instrumental' && instrumental) {
        clip = {
          label: instrumental.name,
          offset: 0,
          width: percent(instrumental.buffer.duration),
          pattern: 'wave',
          waveform: { buffer: instrumental.buffer, toSeconds: Math.min(instrumental.buffer.duration, visibleSeconds) },
        };
      } else if (info.id === 'voice' && take) {
        const offset = percent(Math.max(0, take.startSeconds));
        const visibleTakeSeconds = Math.max(0, Math.min(take.buffer.duration, visibleSeconds - Math.max(0, take.startSeconds)));
        clip =
          offset < 100
            ? {
                label: take.name,
                offset,
                width: Math.max(1, Math.min(100 - offset, percent(take.buffer.duration))),
                pattern: 'wave',
                waveform: { buffer: take.buffer, toSeconds: Math.max(0.01, visibleTakeSeconds) },
              }
            : null;
      }
      return { ...info, clip, mix: mixer[info.id] };
    });
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

  /** Utilisé par `unsavedChangesGuard` avant de quitter le studio. */
  canLeave(): boolean {
    if (this.studioProject.uploading()) {
      return confirm('L’instrumentale est en cours d’envoi. Quitter interrompt l’envoi. Quitter quand même ?');
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.studioProject.project()) {
      event.preventDefault();
      this.studioProject.save();
    }
  }

  toggleRecording(): void {
    // L'arrêt passe par le projet : la nouvelle prise y est aussitôt envoyée.
    void (this.session.micState() === 'recording' ? this.studioProject.stopRecording() : this.session.startRecording());
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
