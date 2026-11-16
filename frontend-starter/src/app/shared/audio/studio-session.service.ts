import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { validateAudioFile } from './audio-file';
import { DrumPattern, DrumVoice, createDemoPattern, toggleStep } from './drum-pattern';
import { gainToDecibels } from './mix-graph';
import { MicrophoneRecorder, describeMicrophoneError, takeStartSeconds } from './microphone-recorder';
import { DEFAULT_BPM, STEPS_PER_BAR, STEPS_PER_BEAT, isValidBpm } from './music-time';
import { renderMix } from './offline-render';
import { PatternTransport, TrackClip } from './pattern-transport';
import { NOTE_NAMES, SCALE_LABELS } from './pitch/musical-scale';
import { ProjectKey } from './pitch/vocal-styles';
import { MixerState, TrackId, TrackMix, clampTrackDb, createDefaultMixer, effectiveTrackGains, updateTrack } from './track-mix';
import { encodeWav, peakLevel } from './wav-encoder';

/** Gains appliqués aux fichiers audio du studio (linéaires). */
const INSTRUMENTAL_GAIN = 0.7;
const TAKE_GAIN = 1;

export type MicState = 'idle' | 'opening' | 'recording' | 'saving';
export type TransportState = 'stopped' | 'playing' | 'paused';

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

/** Version corrigée de la prise, produite par l'onglet Correction vocale (l'original reste intact). */
export interface CorrectedTake {
  readonly buffer: AudioBuffer;
  /** Style appliqué, pour l'affichage (« Trap », « Personnalisé (basé sur Raï) »…). */
  readonly styleLabel: string;
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
  readonly transportState = signal<TransportState>('stopped');
  readonly playing = computed(() => this.transportState() === 'playing');
  /** Pas absolu de la tête de lecture (0 = début du morceau), conservé pendant une pause. */
  readonly songStep = signal(0);
  /** Pas en surbrillance dans le séquenceur, ou -1 à l'arrêt. */
  readonly currentStep = computed(() => (this.transportState() === 'stopped' ? -1 : this.songStep() % STEPS_PER_BAR));
  readonly metronome = signal(false);
  /** Tonalité du projet (la mineur par défaut) : reprise par la correction vocale. */
  readonly projectKey = signal<ProjectKey>({ root: 9, scale: 'minor' });
  readonly projectKeyLabel = computed(() => `${NOTE_NAMES[this.projectKey().root]} ${SCALE_LABELS[this.projectKey().scale]}`);
  readonly mixer = signal<MixerState>(createDefaultMixer());
  readonly engineError = signal<string | null>(null);

  readonly instrumental = signal<LoadedAudio | null>(null);
  readonly importing = signal(false);
  readonly importError = signal<string | null>(null);

  readonly micState = signal<MicState>('idle');
  readonly micError = signal<string | null>(null);
  readonly take = signal<VocalTake | null>(null);
  readonly correctedTake = signal<CorrectedTake | null>(null);
  /** Lire la version corrigée sur la piste Voix (écoute et export) au lieu de l'originale. */
  readonly useCorrectedTake = signal(false);

  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly exportReport = signal<ExportReport | null>(null);

  /** Position affichée (mesure, temps, double-croche), 1-indexée. */
  readonly position = computed(() => {
    const step = Math.max(0, this.songStep());
    const inBar = step % STEPS_PER_BAR;
    return {
      bar: Math.floor(step / STEPS_PER_BAR) + 1,
      beat: Math.floor(inBar / STEPS_PER_BEAT) + 1,
      sixteenth: (inBar % STEPS_PER_BEAT) + 1,
    };
  });

  constructor() {
    // Volume, mute et solo s'appliquent pendant la lecture, sans la relancer.
    effect(() => {
      const gains = effectiveTrackGains(this.mixer());
      this.transport?.setTrackGains(gains);
    });
  }

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

  /** Lecture / pause : la pause garde la position, la lecture reprend au même pas. */
  async togglePlayback(): Promise<void> {
    if (this.playing()) {
      this.pausePlayback();
      return;
    }
    await this.startPlayback();
  }

  pausePlayback(): void {
    if (!this.playing()) {
      return;
    }
    this.haltTransport();
    this.transportState.set('paused');
  }

  /** Arrête et revient au début du morceau. */
  stopPlayback(): void {
    this.haltTransport();
    this.transportState.set('stopped');
    this.songStep.set(0);
  }

  setTrack(track: TrackId, change: Partial<TrackMix>): void {
    const safe = change.volumeDb === undefined ? change : { ...change, volumeDb: clampTrackDb(change.volumeDb) };
    this.mixer.update(mixer => updateTrack(mixer, track, safe));
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

  /**
   * Ouvre le micro, lance la prod à la position courante (début, ou position de pause),
   * puis enregistre la voix sur la même horloge.
   */
  async startRecording(): Promise<void> {
    if (this.micState() !== 'idle') {
      return;
    }
    this.pausePlayback();
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
      // Une nouvelle prise rend l'ancienne correction obsolète.
      this.correctedTake.set(null);
      this.useCorrectedTake.set(false);
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
      const gains = effectiveTrackGains(this.mixer());
      const clips = this.trackClips(true).map(({ track, clip }) => ({ ...clip, gain: clip.gain * gains[track] }));
      const rendered = await renderMix({ pattern: this.pattern(), bpm: this.bpm(), bars, drumsGain: gains.drums, clips });
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

  /** Démarre la lecture à la position courante (début du morceau, ou reprise après une pause). */
  private async startPlayback(includeTake = true): Promise<boolean> {
    try {
      const { context, master } = await this.engine.start();
      this.transport ??= new PatternTransport(context, master, () => this.pattern(), () => this.bpm(), () => this.metronome());
      const fromSongStep = this.transportState() === 'paused' ? this.songStep() : 0;
      this.transport.play({ clips: this.trackClips(includeTake), gains: effectiveTrackGains(this.mixer()), fromSongStep }, this.bpm());
      this.engineError.set(null);
      this.songStep.set(fromSongStep);
      this.transportState.set('playing');
      this.followPlayhead();
      return true;
    } catch (error) {
      console.error('[studio] démarrage audio impossible', error);
      this.engineError.set("Le moteur audio n'a pas pu démarrer dans ce navigateur.");
      return false;
    }
  }

  /** Clips à programmer ; le mute et le solo sont appliqués par les gains de piste. */
  private trackClips(includeTake: boolean): TrackClip[] {
    const clips: TrackClip[] = [];
    const instrumental = this.instrumental();
    if (instrumental) {
      clips.push({ track: 'instrumental', clip: { buffer: instrumental.buffer, startSeconds: 0, gain: INSTRUMENTAL_GAIN } });
    }
    const take = this.take();
    if (includeTake && take) {
      const corrected = this.useCorrectedTake() ? this.correctedTake() : null;
      // Même position que l'original : la correction conserve la durée de la prise.
      clips.push({ track: 'voice', clip: { buffer: corrected?.buffer ?? take.buffer, startSeconds: take.startSeconds, gain: TAKE_GAIN } });
    }
    return clips;
  }

  private haltTransport(): void {
    cancelAnimationFrame(this.animationFrame);
    this.transport?.stop();
  }

  /** Tête de lecture : le signal n'est écrit que lorsque le pas change (16 fois par mesure). */
  private followPlayhead(): void {
    const frame = () => {
      if (this.transport) {
        const step = this.transport.songStepAt(this.engine.currentTime());
        if (step >= 0 && step !== this.songStep()) {
          this.songStep.set(step);
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
