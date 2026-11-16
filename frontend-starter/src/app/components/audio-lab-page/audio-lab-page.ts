import { Component, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AudioEngineService } from '../../shared/audio/audio-engine.service';
import { AUDIO_FILE_ACCEPT, validateAudioFile } from '../../shared/audio/audio-file';
import { DRUM_VOICES, DRUM_VOICE_LABELS, DrumPattern, DrumVoice, createDemoPattern, toggleStep } from '../../shared/audio/drum-pattern';
import { AudioClip, gainToDecibels } from '../../shared/audio/mix-graph';
import { MicrophoneRecorder, describeMicrophoneError, takeStartSeconds } from '../../shared/audio/microphone-recorder';
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, STEPS_PER_BAR, STEPS_PER_BEAT, isValidBpm } from '../../shared/audio/music-time';
import { renderMix } from '../../shared/audio/offline-render';
import { PatternTransport } from '../../shared/audio/pattern-transport';
import { encodeWav, peakLevel } from '../../shared/audio/wav-encoder';

/** Gains appliqués aux fichiers audio dans le prototype (linéaires). */
const INSTRUMENTAL_GAIN = 0.7;
const TAKE_GAIN = 1;
const EXPORT_BAR_CHOICES = [1, 2, 4, 8] as const;
const DEFAULT_EXPORT_BARS = 4;

type MicState = 'idle' | 'opening' | 'recording' | 'saving';

interface LoadedAudio {
  readonly name: string;
  readonly buffer: AudioBuffer;
}

interface VocalTake {
  readonly buffer: AudioBuffer;
  /** ObjectURL de la prise originale (non modifiée), libéré au remplacement et à la fermeture. */
  readonly url: string;
  readonly mimeType: string;
  readonly startSeconds: number;
  readonly latencyMs: number;
}

interface ExportReport {
  readonly seconds: number;
  readonly peakDb: number;
}

/**
 * Prototype M0 : vérifie la lecture synchronisée, le séquenceur, la prise micro
 * et l'export avant de construire le vrai studio. Page volontairement isolée.
 */
@Component({
  selector: 'app-audio-lab-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './audio-lab-page.html',
  styleUrl: './audio-lab-page.css',
})
export class AudioLabPageComponent implements OnDestroy {
  private readonly engine = inject(AudioEngineService);
  private readonly recorder = new MicrophoneRecorder();
  private transport: PatternTransport | null = null;
  private animationFrame = 0;
  private recorderStartedAt: number | null = null;

  readonly voices = DRUM_VOICES;
  readonly voiceLabels = DRUM_VOICE_LABELS;
  readonly steps = Array.from({ length: STEPS_PER_BAR }, (_, step) => step);
  readonly stepsPerBeat = STEPS_PER_BEAT;
  readonly minBpm = MIN_BPM;
  readonly maxBpm = MAX_BPM;
  readonly exportBarChoices = EXPORT_BAR_CHOICES;
  readonly audioAccept = AUDIO_FILE_ACCEPT;

  readonly bpmControl = new FormControl(DEFAULT_BPM, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(MIN_BPM), Validators.max(MAX_BPM)],
  });
  readonly includeInstrumental = new FormControl(true, { nonNullable: true });
  readonly includeTake = new FormControl(true, { nonNullable: true });
  readonly exportBars = new FormControl<number>(DEFAULT_EXPORT_BARS, { nonNullable: true });

  /** BPM effectivement utilisé : une saisie invalide ne l'écrase pas. */
  readonly bpm = signal(DEFAULT_BPM);
  readonly pattern = signal<DrumPattern>(createDemoPattern());
  readonly playing = signal(false);
  readonly currentStep = signal(-1);
  readonly engineError = signal<string | null>(null);

  readonly instrumental = signal<LoadedAudio | null>(null);
  readonly importing = signal(false);
  readonly importError = signal<string | null>(null);

  readonly micState = signal<MicState>('idle');
  readonly micError = signal<string | null>(null);
  readonly take = signal<VocalTake | null>(null);

  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly exportReport = signal<ExportReport | null>(null);

  constructor() {
    this.bpmControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => {
      if (isValidBpm(value)) {
        this.bpm.set(value);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopPlayback();
    this.recorder.release();
    this.revokeTakeUrl();
    void this.engine.suspend();
  }

  stepLabel(voice: DrumVoice, step: number): string {
    const state = this.pattern()[voice][step] ? 'actif' : 'inactif';
    return `${this.voiceLabels[voice]}, pas ${step + 1}, ${state}`;
  }

  toggle(voice: DrumVoice, step: number): void {
    this.pattern.update(pattern => toggleStep(pattern, voice, step));
  }

  async togglePlayback(): Promise<void> {
    if (this.playing()) {
      this.stopPlayback();
      return;
    }
    await this.startPlayback();
  }

  async onInstrumentalSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const validationError = validateAudioFile(file);
    this.importError.set(validationError);
    if (validationError) {
      return;
    }
    this.importing.set(true);
    try {
      const buffer = await this.engine.decode(await file.arrayBuffer());
      this.instrumental.set({ name: file.name, buffer });
      console.log('[audio-lab] instrumentale chargée', { durationSeconds: buffer.duration });
    } catch (error) {
      console.error('[audio-lab] décodage impossible', error);
      this.importError.set('Fichier illisible ou corrompu : le navigateur ne parvient pas à le décoder.');
    } finally {
      this.importing.set(false);
    }
  }

  /** Ouvre le micro, lance la prod, puis enregistre la voix sur la même horloge. */
  async startRecording(): Promise<void> {
    this.micError.set(null);
    this.micState.set('opening');
    try {
      await this.recorder.open();
    } catch (error) {
      console.error('[audio-lab] micro indisponible', error);
      this.micError.set(error instanceof Error && !(error instanceof DOMException) ? error.message : describeMicrophoneError(error));
      this.micState.set('idle');
      return;
    }
    // La prise en cours d'enregistrement ne doit pas être rejouée sous elle-même.
    const started = await this.startPlayback(false);
    if (!started) {
      this.recorder.release();
      this.micState.set('idle');
      return;
    }
    this.recorderStartedAt = null;
    this.recorder.record(() => {
      this.recorderStartedAt = this.transportContextTime();
    });
    this.micState.set('recording');
  }

  async stopRecording(): Promise<void> {
    const songStart = this.transport?.startTime ?? null;
    this.micState.set('saving');
    this.stopPlayback();
    try {
      const recorded = await this.recorder.stop();
      const buffer = await this.engine.decode(await recorded.blob.arrayBuffer());
      const latencySeconds = this.engine.outputLatencySeconds() + recorded.inputLatencySeconds;
      const startSeconds =
        songStart !== null && this.recorderStartedAt !== null
          ? takeStartSeconds(this.recorderStartedAt, songStart, latencySeconds)
          : 0;
      this.revokeTakeUrl();
      this.take.set({
        buffer,
        url: URL.createObjectURL(recorded.blob),
        mimeType: recorded.mimeType,
        startSeconds,
        latencyMs: Math.round(latencySeconds * 1000),
      });
      console.log('[audio-lab] prise enregistrée', { durationSeconds: buffer.duration, startSeconds });
    } catch (error) {
      console.error('[audio-lab] échec de la prise', error);
      this.micError.set(error instanceof Error ? error.message : "La prise n'a pas pu être enregistrée.");
    } finally {
      this.recorder.release();
      this.micState.set('idle');
    }
  }

  async exportWav(): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.exportError.set(null);
    this.exportReport.set(null);
    try {
      const rendered = await renderMix({
        pattern: this.pattern(),
        bpm: this.bpm(),
        bars: this.exportBars.value,
        clips: this.activeClips(true),
      });
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index));
      const wav = new Blob([encodeWav(channels, rendered.sampleRate)], { type: 'audio/wav' });
      this.download(wav, `zakat-record-prototype-${this.bpm()}bpm.wav`);
      this.exportReport.set({ seconds: rendered.duration, peakDb: gainToDecibels(peakLevel(channels)) });
    } catch (error) {
      console.error('[audio-lab] export impossible', error);
      this.exportError.set("L'export a échoué. Réessayez avec moins de mesures.");
    } finally {
      this.exporting.set(false);
    }
  }

  formatSeconds(seconds: number): string {
    return `${seconds.toFixed(2).replace('.', ',')} s`;
  }

  formatDecibels(decibels: number): string {
    return Number.isFinite(decibels) ? `${decibels.toFixed(1).replace('.', ',')} dBFS` : 'silence';
  }

  private async startPlayback(includeTake = true): Promise<boolean> {
    try {
      const { context, master } = await this.engine.start();
      this.transport ??= new PatternTransport(context, master, () => this.pattern(), () => this.bpm());
      this.transport.play(this.activeClips(includeTake));
      this.engineError.set(null);
      this.playing.set(true);
      this.followPlayhead();
      return true;
    } catch (error) {
      console.error('[audio-lab] démarrage audio impossible', error);
      this.engineError.set("Le moteur audio n'a pas pu démarrer dans ce navigateur.");
      return false;
    }
  }

  private stopPlayback(): void {
    cancelAnimationFrame(this.animationFrame);
    this.transport?.stop();
    this.playing.set(false);
    this.currentStep.set(-1);
  }

  private activeClips(includeTake: boolean): AudioClip[] {
    const clips: AudioClip[] = [];
    const instrumental = this.instrumental();
    if (instrumental && this.includeInstrumental.value) {
      clips.push({ buffer: instrumental.buffer, startSeconds: 0, gain: INSTRUMENTAL_GAIN });
    }
    const take = this.take();
    if (includeTake && take && this.includeTake.value) {
      clips.push({ buffer: take.buffer, startSeconds: take.startSeconds, gain: TAKE_GAIN });
    }
    return clips;
  }

  /** Tête de lecture : un signal n'est écrit que lorsque le pas change (16 fois par mesure). */
  private followPlayhead(): void {
    const frame = () => {
      const now = this.transportContextTime();
      if (this.transport && now !== null) {
        const step = this.transport.stepAt(now);
        if (step !== this.currentStep()) {
          this.currentStep.set(step);
        }
      }
      this.animationFrame = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(frame);
  }

  private transportContextTime(): number | null {
    return this.transport ? this.engine.currentTime() : null;
  }

  private revokeTakeUrl(): void {
    const take = this.take();
    if (take) {
      URL.revokeObjectURL(take.url);
    }
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    // Libéré après le démarrage du téléchargement par le navigateur.
    setTimeout(() => URL.revokeObjectURL(url));
  }
}
