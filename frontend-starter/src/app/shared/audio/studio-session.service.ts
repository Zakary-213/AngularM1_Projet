import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { validateAudioFile } from './audio-file';
import { DrumPattern, DrumVoice, createDemoPattern, toggleStep } from './drum-pattern';
import { gainToDecibels } from './mix-graph';
import { InputDevice, MicrophoneRecorder, describeMicrophoneError, takeStartSeconds, toInputDevices } from './microphone-recorder';
import { DEFAULT_BPM, STEPS_PER_BAR, STEPS_PER_BEAT, isValidBpm } from './music-time';
import { renderMix } from './offline-render';
import { PatternTransport, TrackClip } from './pattern-transport';
import { NOTE_NAMES, SCALE_LABELS } from './pitch/musical-scale';
import { ProjectKey } from './pitch/vocal-styles';
import { FLAT_THREE_BAND_EQ, ThreeBandEq, clampEq } from './three-band-eq';
import { MixerState, TrackId, TrackMix, clampTrackDb, createDefaultMixer, effectiveTrackGains, updateTrack } from './track-mix';
import { encodeWav, peakLevel, rmsLevel } from './wav-encoder';

/** Gains appliqués aux fichiers audio du studio (linéaires). */
const INSTRUMENTAL_GAIN = 0.7;
const TAKE_GAIN = 1;
/** Nombre maximal de prises sur la piste Voix (mémoire et lisibilité de la liste). */
export const MAX_TAKES = 8;
export const TAKE_NAME_MAX_LENGTH = 40;
/** Rafraîchissement de l'indicateur de niveau : 10 fois par seconde suffit à l'œil. */
const LEVEL_UPDATE_MS = 100;
/** Crête au-delà de laquelle la prise risque d'être saturée. */
const CLIPPING_PEAK = 0.98;
/** Pas du décalage manuel d'une prise (correction de latence), en secondes. */
export const TAKE_NUDGE_SECONDS = 0.01;
/** Décalage manuel maximal dans un sens ou dans l'autre, en secondes. */
const MAX_TAKE_SHIFT_SECONDS = 1;

export type MicState = 'idle' | 'opening' | 'recording' | 'saving';
export type TransportState = 'stopped' | 'playing' | 'paused';

export interface LoadedAudio {
  readonly name: string;
  readonly buffer: AudioBuffer;
  /** Fichier de la bibliothèque serveur (Track) une fois envoyé, sinon `null` (local à l'onglet). */
  readonly fileId: string | null;
}

export interface VocalTake {
  /** Identifiant stable (clip du projet). */
  readonly id: string;
  /** Nom affiché, modifiable (« Prise 1 »…). */
  readonly name: string;
  /** Enregistrement original tel que capté, pour l'envoi au serveur et l'écoute seule. */
  readonly blob: Blob;
  /** Fichier de la bibliothèque serveur une fois envoyé, sinon `null`. */
  readonly fileId: string | null;
  readonly buffer: AudioBuffer;
  /** ObjectURL de la prise originale (non modifiée), libéré au remplacement et à la fermeture. */
  readonly url: string;
  readonly mimeType: string;
  readonly startSeconds: number;
  /** Position avant tout décalage manuel (borne du décalage). */
  readonly recordedStartSeconds?: number;
  readonly latencyMs: number;
}

/** Version corrigée de la prise, produite par l'onglet Correction vocale (l'original reste intact). */
export interface CorrectedTake {
  readonly buffer: AudioBuffer;
  /** Style appliqué, pour l'affichage (« Trap », « Personnalisé (basé sur Raï) »…). */
  readonly styleLabel: string;
}

/** Niveau du micro pendant l'enregistrement (0 à 1, échelle linéaire). */
export interface InputLevel {
  readonly rms: number;
  readonly peak: number;
  /** Crête proche de 0 dBFS pendant la dernière seconde : risque de saturation. */
  readonly clipping: boolean;
}

const SILENT_LEVEL: InputLevel = { rms: 0, peak: 0, clipping: false };

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
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levelSource: MediaStreamAudioSourceNode | null = null;
  private lastClipAt = 0;
  private takeCounter = 0;

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
  /** Égaliseur 3 bandes de la piste instrumentale (dB), appliqué à l'écoute et à l'export. */
  readonly instrumentalEq = signal<ThreeBandEq>(FLAT_THREE_BAND_EQ);
  readonly importing = signal(false);
  readonly importError = signal<string | null>(null);

  readonly micState = signal<MicState>('idle');
  readonly micError = signal<string | null>(null);
  /** Prises de la piste Voix, dans l'ordre d'enregistrement. Une seule est jouée : la prise active. */
  readonly takes = signal<VocalTake[]>([]);
  readonly activeTakeId = signal<string | null>(null);
  readonly take = computed(() => this.takes().find(take => take.id === this.activeTakeId()) ?? null);
  readonly canRecordTake = computed(() => this.takes().length < MAX_TAKES);
  readonly inputDevices = signal<InputDevice[]>([]);
  /** Entrée choisie, ou `null` pour l'entrée par défaut du système. */
  readonly selectedInputId = signal<string | null>(null);
  readonly inputLevel = signal<InputLevel>(SILENT_LEVEL);
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
    effect(() => {
      const eq = this.instrumentalEq();
      this.transport?.setInstrumentalEq(eq);
    });
  }

  ngOnDestroy(): void {
    this.stopPlayback();
    this.stopLevelMeter();
    this.recorder.release();
    this.takes().forEach(take => URL.revokeObjectURL(take.url));
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

  /** Décode un MP3/WAV local et l'installe sur la piste instrumentale. Renvoie `true` si le fichier est utilisable. */
  async importInstrumental(file: File): Promise<boolean> {
    const validationError = validateAudioFile(file);
    this.importError.set(validationError);
    if (validationError) {
      return false;
    }
    this.importing.set(true);
    try {
      const buffer = await this.engine.decode(await file.arrayBuffer());
      this.setInstrumental({ name: file.name, buffer, fileId: null });
      console.log('[studio] instrumentale chargée', { durationSeconds: buffer.duration });
      return true;
    } catch (error) {
      console.error('[studio] décodage impossible', error);
      this.importError.set('Fichier illisible ou corrompu : le navigateur ne parvient pas à le décoder.');
      return false;
    } finally {
      this.importing.set(false);
    }
  }

  /** Remplace ou retire l'instrumentale ; la lecture en cours est arrêtée pour ne pas jouer l'ancien fichier. */
  setInstrumental(instrumental: LoadedAudio | null): void {
    if (this.transportState() !== 'stopped') {
      this.stopPlayback();
    }
    this.instrumental.set(instrumental);
  }

  /** Associe l'instrumentale courante au fichier envoyé, si c'est toujours le même buffer. */
  markInstrumentalUploaded(buffer: AudioBuffer, fileId: string): void {
    const current = this.instrumental();
    if (current?.buffer === buffer) {
      this.instrumental.set({ ...current, fileId });
    }
  }

  setInstrumentalEq(change: Partial<ThreeBandEq>): void {
    this.instrumentalEq.update(eq => clampEq({ ...eq, ...change }));
  }

  /**
   * Ouvre le micro, lance la prod à la position courante (début, ou position de pause),
   * puis enregistre la voix sur la même horloge.
   */
  async startRecording(): Promise<void> {
    if (this.micState() !== 'idle') {
      return;
    }
    if (!this.canRecordTake()) {
      this.micError.set(`${MAX_TAKES} prises maximum : supprimez une prise pour en enregistrer une nouvelle.`);
      return;
    }
    this.pausePlayback();
    this.micError.set(null);
    this.micState.set('opening');
    try {
      await this.recorder.open(this.selectedInputId());
      // Les noms des entrées ne sont connus qu'une fois le micro autorisé.
      void this.refreshInputDevices();
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
    void this.startLevelMeter();
  }

  async stopRecording(): Promise<void> {
    if (this.micState() !== 'recording') {
      return;
    }
    const songStart = this.transport?.startTime ?? null;
    this.micState.set('saving');
    this.stopLevelMeter();
    this.stopPlayback();
    try {
      const recorded = await this.recorder.stop();
      const buffer = await this.engine.decode(await recorded.blob.arrayBuffer());
      const latencySeconds = this.engine.outputLatencySeconds() + recorded.inputLatencySeconds;
      const startSeconds =
        songStart !== null && this.recorderStartedAt !== null
          ? takeStartSeconds(this.recorderStartedAt, songStart, latencySeconds)
          : 0;
      const take: VocalTake = {
        id: `take-${crypto.randomUUID()}`,
        name: `Prise ${++this.takeCounter}`,
        blob: recorded.blob,
        fileId: null,
        buffer,
        url: URL.createObjectURL(recorded.blob),
        mimeType: recorded.mimeType,
        startSeconds,
        latencyMs: Math.round(latencySeconds * 1000),
      };
      this.takes.update(takes => [...takes, take]);
      // La nouvelle prise devient active ; l'ancienne correction ne la concerne pas.
      this.setActiveTake(take.id);
      this.lastRecordedTake.set(take);
      console.log('[studio] prise enregistrée', { durationSeconds: buffer.duration, startSeconds });
    } catch (error) {
      console.error('[studio] échec de la prise', error);
      this.micError.set(error instanceof Error ? error.message : "La prise n'a pas pu être enregistrée.");
    } finally {
      this.recorder.release();
      this.micState.set('idle');
    }
  }

  /** Dernière prise enregistrée dans cet onglet (le projet l'envoie au serveur). */
  readonly lastRecordedTake = signal<VocalTake | null>(null);

  /** Choisit la prise jouée sur la piste Voix. */
  selectTake(id: string): void {
    if (this.takes().some(take => take.id === id) && id !== this.activeTakeId()) {
      if (this.transportState() !== 'stopped') {
        this.stopPlayback();
      }
      this.setActiveTake(id);
    }
  }

  /** Renomme une prise ; renvoie `false` si le nom est vide ou trop long. */
  renameTake(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > TAKE_NAME_MAX_LENGTH) {
      return false;
    }
    this.takes.update(takes => takes.map(take => (take.id === id ? { ...take, name: trimmed } : take)));
    return true;
  }

  /** Supprime une prise de la session ; la précédente (ou la suivante) devient active. */
  removeTake(id: string): void {
    const takes = this.takes();
    const index = takes.findIndex(take => take.id === id);
    if (index < 0) {
      return;
    }
    if (this.transportState() !== 'stopped') {
      this.stopPlayback();
    }
    URL.revokeObjectURL(takes[index].url);
    const remaining = takes.filter(take => take.id !== id);
    this.takes.set(remaining);
    if (this.activeTakeId() === id) {
      this.setActiveTake(remaining[Math.min(index, remaining.length) - 1]?.id ?? remaining[0]?.id ?? null);
    }
  }

  /**
   * Décale une prise dans le morceau (correction manuelle de latence), dans la limite
   * d'une seconde autour de la position estimée à l'enregistrement. Renvoie la nouvelle position.
   */
  shiftTake(id: string, deltaSeconds: number): number | null {
    const current = this.takes().find(take => take.id === id);
    if (!current || !Number.isFinite(deltaSeconds)) {
      return null;
    }
    const origin = current.recordedStartSeconds ?? current.startSeconds;
    const shifted = Math.round((current.startSeconds + deltaSeconds) * 1000) / 1000;
    const startSeconds = Math.min(origin + MAX_TAKE_SHIFT_SECONDS, Math.max(origin - MAX_TAKE_SHIFT_SECONDS, shifted));
    if (this.transportState() !== 'stopped') {
      this.stopPlayback();
    }
    this.takes.update(takes => takes.map(take => (take.id === id ? { ...take, startSeconds, recordedStartSeconds: origin } : take)));
    return startSeconds;
  }

  /** Associe une prise au fichier envoyé dans la bibliothèque. */
  markTakeUploaded(id: string, fileId: string): void {
    this.takes.update(takes => takes.map(take => (take.id === id ? { ...take, fileId } : take)));
  }

  /**
   * Ajoute une prise récupérée depuis le serveur à l'ouverture d'un projet,
   * en respectant l'ordre enregistré (`order` : identifiants des prises du projet).
   */
  restoreTake(take: VocalTake, order: readonly string[]): void {
    const rank = (candidate: VocalTake) => {
      const position = order.indexOf(candidate.id);
      return position < 0 ? Number.MAX_SAFE_INTEGER : position;
    };
    this.takes.update(takes => [...takes.filter(existing => existing.id !== take.id), take].sort((a, b) => rank(a) - rank(b)));
    // Les nouvelles prises continuent la numérotation (« Prise 4 » après trois prises).
    this.takeCounter = Math.max(this.takeCounter, order.length);
  }

  /** Vide la piste Voix (ouverture d'un autre projet). */
  clearTakes(activeTakeId: string | null = null): void {
    this.takes().forEach(take => URL.revokeObjectURL(take.url));
    this.takes.set([]);
    this.takeCounter = 0;
    this.setActiveTake(activeTakeId);
  }

  /** Liste les entrées audio ; les noms n'apparaissent qu'après l'autorisation du micro. */
  async refreshInputDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = toInputDevices(await navigator.mediaDevices.enumerateDevices());
      this.inputDevices.set(devices);
      const selected = this.selectedInputId();
      if (selected && !devices.some(device => device.deviceId === selected)) {
        // Micro débranché : retour à l'entrée par défaut, signalé à l'utilisateur.
        this.selectedInputId.set(null);
        this.micError.set('Le micro choisi n’est plus disponible : l’entrée par défaut sera utilisée.');
      }
    } catch (error) {
      console.error('[studio] liste des micros indisponible', error);
    }
  }

  private setActiveTake(id: string | null): void {
    if (id !== this.activeTakeId()) {
      // Une correction vocale appartient à une prise : elle ne suit pas le changement.
      this.correctedTake.set(null);
      this.useCorrectedTake.set(false);
    }
    this.activeTakeId.set(id);
  }

  /** Indicateur de niveau : analyse du flux micro, jamais reliée aux haut-parleurs (pas de larsen). */
  private async startLevelMeter(): Promise<void> {
    const stream = this.recorder.inputStream;
    if (!stream) {
      return;
    }
    try {
      const { context } = await this.engine.start();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      this.levelSource = context.createMediaStreamSource(stream);
      this.levelSource.connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      this.levelTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        const peak = peakLevel([frame]);
        const now = Date.now();
        if (peak >= CLIPPING_PEAK) {
          this.lastClipAt = now;
        }
        this.inputLevel.set({ rms: rmsLevel(frame), peak, clipping: now - this.lastClipAt < 1000 });
      }, LEVEL_UPDATE_MS);
    } catch (error) {
      // L'indicateur est un confort : son échec n'interrompt pas l'enregistrement.
      console.error('[studio] indicateur de niveau indisponible', error);
    }
  }

  private stopLevelMeter(): void {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    this.levelSource?.disconnect();
    this.levelSource = null;
    this.lastClipAt = 0;
    this.inputLevel.set(SILENT_LEVEL);
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
      // À l'export, l'égaliseur de l'instrumentale est porté par son clip (même réglage qu'à l'écoute).
      const clips = this.trackClips(true).map(({ track, clip }) => ({
        ...clip,
        gain: clip.gain * gains[track],
        ...(track === 'instrumental' ? { eq: this.instrumentalEq() } : {}),
      }));
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
      this.transport.play(
        { clips: this.trackClips(includeTake), gains: effectiveTrackGains(this.mixer()), fromSongStep, instrumentalEq: this.instrumentalEq() },
        this.bpm(),
      );
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
