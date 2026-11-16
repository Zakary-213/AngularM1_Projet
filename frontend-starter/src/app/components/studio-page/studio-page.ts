import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DrumRackPanelComponent } from '../drum-rack-panel/drum-rack-panel';
import { ExportPanelComponent } from '../export-panel/export-panel';
import { MixerPanelComponent } from '../mixer-panel/mixer-panel';
import { PitchCorrectionPanelComponent } from '../pitch-correction-panel/pitch-correction-panel';
import { AUDIO_FILE_ACCEPT } from '../../shared/audio/audio-file';
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, STEPS_PER_BAR, barsToSeconds } from '../../shared/audio/music-time';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { STUDIO_TRACKS, StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { TrackMix } from '../../shared/audio/track-mix';

/** Niveaux de zoom de la timeline, en mesures visibles (du plus proche au plus large). */
const ZOOM_LEVELS = [4, 8, 16, 32] as const;
const DEFAULT_ZOOM_INDEX = 2;
/** La règle affiche 8 repères quel que soit le zoom (grille de fond à 12,5 %). */
const RULER_MARKS = 8;

type EditorTab = 'Batterie' | 'Correction vocale' | 'Mixeur' | 'Export';

interface TimelineTrack extends StudioTrackInfo {
  /** `null` : piste vide, rien à afficher dans la ligne. */
  readonly clip: { readonly label: string; readonly offset: number; readonly width: number; readonly pattern: 'note' | 'wave' } | null;
  readonly mix: TrackMix;
}

/**
 * Page Studio : assemble le transport, la timeline et les panneaux d'édition.
 * L'état audio vit dans `StudioSessionService`, fourni ici pour qu'il soit libéré
 * (micro, sources, ObjectURL) à la sortie du studio.
 */
@Component({
  selector: 'app-studio-page',
  imports: [RouterLink, ReactiveFormsModule, DrumRackPanelComponent, ExportPanelComponent, MixerPanelComponent, PitchCorrectionPanelComponent],
  providers: [StudioSessionService],
  templateUrl: './studio-page.html',
  styleUrl: './studio-page.css',
})
export class StudioPageComponent {
  readonly session = inject(StudioSessionService);

  readonly editorTabs: readonly EditorTab[] = ['Batterie', 'Correction vocale', 'Mixeur', 'Export'];
  readonly activeTab = signal<EditorTab>('Batterie');
  readonly audioAccept = AUDIO_FILE_ACCEPT;
  readonly minBpm = MIN_BPM;
  readonly maxBpm = MAX_BPM;
  readonly instruments = [{ name: 'Drum machine', type: 'Rythme & percussions', icon: '▦' }, { name: '808 Bass', type: 'Basse & sub', icon: '≋' }, { name: 'Soft keys', type: 'Piano & claviers', icon: '♬' }, { name: 'Microphone', type: 'Voix & prises', icon: '♩' }];

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
        clip = { label: instrumental.name, offset: 0, width: percent(instrumental.buffer.duration), pattern: 'wave' };
      } else if (info.id === 'voice' && take) {
        const offset = percent(Math.max(0, take.startSeconds));
        clip = offset < 100 ? { label: 'Prise voix · 01', offset, width: Math.max(1, Math.min(100 - offset, percent(take.buffer.duration))), pattern: 'wave' } : null;
      }
      return { ...info, clip, mix: mixer[info.id] };
    });
  });

  constructor() {
    this.bpmControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.session.setBpm(value));
  }

  toggleRecording(): void {
    void (this.session.micState() === 'recording' ? this.session.stopRecording() : this.session.startRecording());
  }

  zoom(direction: 'in' | 'out'): void {
    this.zoomIndex.update(index => Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + (direction === 'in' ? -1 : 1))));
  }

  onInstrumentalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.session.importInstrumental(file);
    }
  }

  pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
