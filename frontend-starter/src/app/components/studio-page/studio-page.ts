import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DrumRackPanelComponent } from '../drum-rack-panel/drum-rack-panel';
import { ExportPanelComponent } from '../export-panel/export-panel';
import { PitchCorrectionPanelComponent } from '../pitch-correction-panel/pitch-correction-panel';
import { AUDIO_FILE_ACCEPT } from '../../shared/audio/audio-file';
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, barsToSeconds } from '../../shared/audio/music-time';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

/** Nombre de mesures visibles dans la timeline (règle 1 → 16). */
const TIMELINE_BARS = 16;

type EditorTab = 'Batterie' | 'Correction vocale' | 'Export' | 'Mixeur';

interface TimelineTrack {
  readonly id: 'drums' | 'instrumental' | 'voice';
  readonly name: string;
  readonly type: string;
  readonly color: string;
  readonly className: string;
  /** `null` : piste vide, rien à afficher dans la ligne. */
  readonly clip: { readonly label: string; readonly offset: number; readonly width: number; readonly pattern: 'note' | 'wave' } | null;
  /** `null` : la piste ne peut pas être rendue muette (la batterie est toujours jouée). */
  readonly muted: boolean | null;
}

/**
 * Page Studio : assemble le transport, la timeline et les panneaux d'édition.
 * L'état audio vit dans `StudioSessionService`, fourni ici pour qu'il soit libéré
 * (micro, sources, ObjectURL) à la sortie du studio.
 */
@Component({
  selector: 'app-studio-page',
  imports: [RouterLink, ReactiveFormsModule, DrumRackPanelComponent, ExportPanelComponent, PitchCorrectionPanelComponent],
  providers: [StudioSessionService],
  templateUrl: './studio-page.html',
  styleUrl: './studio-page.css',
})
export class StudioPageComponent {
  readonly session = inject(StudioSessionService);

  readonly editorTabs: readonly EditorTab[] = ['Batterie', 'Correction vocale', 'Export', 'Mixeur'];
  readonly activeTab = signal<EditorTab>('Batterie');
  readonly rulerBars = Array.from({ length: TIMELINE_BARS / 2 }, (_, index) => index * 2 + 1);
  readonly audioAccept = AUDIO_FILE_ACCEPT;
  readonly minBpm = MIN_BPM;
  readonly maxBpm = MAX_BPM;
  readonly instruments = [{ name: 'Drum machine', type: 'Rythme & percussions', icon: '▦' }, { name: '808 Bass', type: 'Basse & sub', icon: '≋' }, { name: 'Soft keys', type: 'Piano & claviers', icon: '♬' }, { name: 'Microphone', type: 'Voix & prises', icon: '♩' }];

  readonly bpmControl = new FormControl(DEFAULT_BPM, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(MIN_BPM), Validators.max(MAX_BPM)],
  });

  /** Pistes réelles de la session, placées sur une fenêtre de `TIMELINE_BARS` mesures. */
  readonly tracks = computed<TimelineTrack[]>(() => {
    const visibleSeconds = barsToSeconds(TIMELINE_BARS, this.session.bpm());
    const percent = (seconds: number) => Math.min(100, (100 * seconds) / visibleSeconds);
    const instrumental = this.session.instrumental();
    const take = this.session.take();
    return [
      { id: 'drums', name: 'Batterie', type: 'Drum Rack', color: '#c1ed75', className: 'clip-lime', clip: { label: 'Pattern 01 · boucle 1 mesure', offset: 0, width: 100, pattern: 'note' }, muted: null },
      {
        id: 'instrumental', name: 'Instrumentale', type: 'Audio importé', color: '#bda4fa', className: 'clip-purple',
        clip: instrumental ? { label: instrumental.name, offset: 0, width: percent(instrumental.buffer.duration), pattern: 'wave' } : null,
        muted: this.session.instrumentalMuted(),
      },
      {
        id: 'voice', name: 'Voix principale', type: 'Prise micro', color: '#8bc8dd', className: 'clip-blue',
        clip: take ? { label: 'Prise voix · 01', offset: percent(take.startSeconds), width: Math.max(1, percent(take.buffer.duration)), pattern: 'wave' } : null,
        muted: this.session.takeMuted(),
      },
    ];
  });

  constructor() {
    this.bpmControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.session.setBpm(value));
  }

  toggleRecording(): void {
    void (this.session.micState() === 'recording' ? this.session.stopRecording() : this.session.startRecording());
  }

  toggleMute(track: TimelineTrack): void {
    if (track.id === 'instrumental') {
      this.session.instrumentalMuted.update(muted => !muted);
    } else if (track.id === 'voice') {
      this.session.takeMuted.update(muted => !muted);
    }
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
