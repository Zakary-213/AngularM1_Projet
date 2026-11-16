import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { validateAudioFile } from './audio-file';
import { DrumPattern, DrumVoice, createDemoPattern, toggleStep } from './drum-pattern';
import { AudioClip, gainToDecibels } from './mix-graph';
import { MicrophoneRecorder, describeMicrophoneError, takeStartSeconds } from './microphone-recorder';
import { DEFAULT_BPM, STEPS_PER_BAR, STEPS_PER_BEAT, isValidBpm } from './music-time';
import { renderMix } from './offline-render';
import { PatternTransport } from './pattern-transport';
import { encodeWav, peakLevel } from './wav-encoder';

/** Gains appliqués aux fichiers audio du studio (linéaires). */
const INSTRUMENTAL_GAIN = 0.7;
const TAKE_GAIN = 1;

export type MicState = 'idle' | 'opening' | 'recording' | 'saving';

export interface LoadedAudio {
  readonly name: string;
  readonly buffer: AudioBuffer;
}

export interface VocalTake {
  readonly buffer: AudioBuffer;
  /** ObjectURL de la prise originale (non modifiée), libéré au remplacement et à la fermeture. */
  readonly url: string;
  readonly mimeType: string;
  readonly startSeconds: number;
  readonly latencyMs: number;
}

export interface ExportReport {
  readonly seconds: number;
  readonly peakDb: number;
}

/**
 * État audio d'une session de studio : transport, pattern de batterie, instrumentale,
 * prise vocale et export. Fourni par la page Studio (une instance par ouverture),
 * il libère micro, sources et ObjectURL à sa destruction.
 */
@Injectable()
export class StudioSessionService implements OnDestroy {
  private readonly engine = inject(AudioEngineService);
  private readonly recorder = new MicrophoneRecorder();
  private transport: PatternTransport | null = null;
  private animationFrame = 0;
  private recorderStartedAt: number | null = null;

  /** BPM effectivement utilisé : une saisie invalide ne l'écrase jamais. */
  readonly bpm = signal(DEFAULT_BPM);
  readonly pattern = signal<DrumPattern>(createDemoPattern());
  readonly playing = signal(false);
  readonly currentStep = signal(-1);
  readonly engineError = signal<string | null>(null);

  readonly instrumental = signal<LoadedAudio | null>(null);
  readonly instrumentalMuted = signal(false);
  readonly importing = signal(false);
  readonly importError = signal<string | null>(null);

  readonly micState = signal<MicState>('idle');
  readonly micError = signal<string | null>(null);
  readonly take = signal<VocalTake | null>(null);
  readonly takeMuted = signal(false);

  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly exportReport = signal<ExportReport | null>(null);

  /** Position affichée (temps et double-croche dans la mesure en boucle), 1-indexée. */
  readonly position = computed(() => {
    const step = Math.max(0, this.currentStep());
    return { beat: Math.floor(step / STEPS_PER_BEAT) + 1, sixteenth: (step % STEPS_PER_BEAT) + 1 };
  });

  ngOnDestroy(): void {
    this.stopPlayback();
    this.recorder.release();
    this.revokeTakeUrl();
    void this.engine.suspend();
  }

  setBpm(value: number): void {
    if (isValidBpm(value)) {
      this.bpm.set(value);
    }
  }

  toggleStep(voice: DrumVoice, step: number): void {
    if (step >= 0 && step < STEPS_PER_BAR) {
      this.pattern.update(pattern => toggleStep(pattern, voice, step));
    }
  }

  async togglePlayback(): Promise<void> {
    if (this.playing()) {
      this.stopPlayback();
      return;
    }
    await this.startPlayback();
  }

  stopPlayback(): void {
    cancelAnimationFrame(this.animationFrame);
    this.transport?.stop();
    this.playing.set(false);
    this.currentStep.set(-1);
  }

  async importInstrumental(file: File): Promise<void> {
    const validationError = validateAudioFile(file);
    this.importError.set(validationError);
    if (validationError) {
      return;
    }
    this.importing.set(true);
    try {
      const buffer = await this.engine.decode(await file.arrayBuffer());
      this.instrumental.set({ name: file.name, buffer });
      console.log('[studio] instrumentale chargée', { durationSeconds: buffer.duration });
    } catch (error) {
      console.error('[studio] décodage impossible', error);
      this.importError.set('Fichier illisible ou corrompu : le navigateur ne parvient pas à le décoder.');
    } finally {
      this.importing.set(false);
    }
  }

  /** Ouvre le micro, lance la prod, puis enregistre la voix sur la même horloge. */
  async startRecording(): Promise<void> {
    if (this.micState() !== 'idle') {
      return;
    }
    this.stopPlayback();
    this.micError.set(null);
    this.micState.set('opening');
    try {
      await this.recorder.open();
    } catch (error) {
      console.error('[studio] micro indisponible', error);
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
      this.recorderStartedAt = this.transport ? this.engine.currentTime() : null;
    });
    this.micState.set('recording');
  }

  async stopRecording(): Promise<void> {
    if (this.micState() !== 'recording') {
      return;
    }
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
      console.log('[studio] prise enregistrée', { durationSeconds: buffer.duration, startSeconds });
    } catch (error) {
      console.error('[studio] échec de la prise', error);
      this.micError.set(error instanceof Error ? error.message : "La prise n'a pas pu être enregistrée.");
    } finally {
      this.recorder.release();
      this.micState.set('idle');
    }
  }

  /** Rendu hors temps réel du mix écouté (pistes non muettes) puis téléchargement en WAV. */
  async exportWav(bars: number): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.exportError.set(null);
    this.exportReport.set(null);
    try {
      const rendered = await renderMix({ pattern: this.pattern(), bpm: this.bpm(), bars, clips: this.activeClips(true) });
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index));
      const wav = new Blob([encodeWav(channels, rendered.sampleRate)], { type: 'audio/wav' });
      downloadBlob(wav, `zakat-record-${this.bpm()}bpm.wav`);
      this.exportReport.set({ seconds: rendered.duration, peakDb: gainToDecibels(peakLevel(channels)) });
    } catch (error) {
      console.error('[studio] export impossible', error);
      this.exportError.set("L'export a échoué. Réessayez avec moins de mesures.");
    } finally {
      this.exporting.set(false);
    }
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
      console.error('[studio] démarrage audio impossible', error);
      this.engineError.set("Le moteur audio n'a pas pu démarrer dans ce navigateur.");
      return false;
    }
  }

  private activeClips(includeTake: boolean): AudioClip[] {
    const clips: AudioClip[] = [];
    const instrumental = this.instrumental();
    if (instrumental && !this.instrumentalMuted()) {
      clips.push({ buffer: instrumental.buffer, startSeconds: 0, gain: INSTRUMENTAL_GAIN });
    }
    const take = this.take();
    if (includeTake && take && !this.takeMuted()) {
      clips.push({ buffer: take.buffer, startSeconds: take.startSeconds, gain: TAKE_GAIN });
    }
    return clips;
  }

  /** Tête de lecture : le signal n'est écrit que lorsque le pas change (16 fois par mesure). */
  private followPlayhead(): void {
    const frame = () => {
      if (this.transport) {
        const step = this.transport.stepAt(this.engine.currentTime());
        if (step !== this.currentStep()) {
          this.currentStep.set(step);
        }
      }
      this.animationFrame = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(frame);
  }

  private revokeTakeUrl(): void {
    const take = this.take();
    if (take) {
      URL.revokeObjectURL(take.url);
    }
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Libéré après le démarrage du téléchargement par le navigateur.
  setTimeout(() => URL.revokeObjectURL(url));
}
