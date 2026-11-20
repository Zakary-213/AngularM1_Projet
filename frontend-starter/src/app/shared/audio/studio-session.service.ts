import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { validateAudioFile } from './audio-file';
import {
  DEFAULT_PATTERN_ID,
  DrumPattern,
  DrumVoice,
  MAX_PATTERNS,
  PATTERN_NAME_MAX_LENGTH,
  PatternEntry,
  createDemoPattern,
  createEmptyPattern,
  createPatternId,
  cycleStep,
  nextPatternName,
  shiftRow,
  toggleStep,
} from './drum-pattern';
import { gainToDecibels } from './mix-graph';
import { InputDevice, MicrophoneRecorder, describeMicrophoneError, takeStartSeconds, toInputDevices } from './microphone-recorder';
import { DEFAULT_BPM, STEPS_PER_BAR, STEPS_PER_BEAT, isValidBpm, stepDurationSeconds } from './music-time';
import { renderMix } from './offline-render';
import { PatternTransport, TrackClip } from './pattern-transport';
import { NOTE_NAMES, SCALE_LABELS } from './pitch/musical-scale';
import { ProjectKey } from './pitch/vocal-styles';
import { FLAT_THREE_BAND_EQ, ThreeBandEq, clampEq } from './three-band-eq';
import { DEFAULT_LOOP_BARS, LoopBars, MAX_SONG_BARS, clampSongStep, loopStepRange, validateLoopBars } from './timeline-position';
import {
  DEFAULT_DRUM_CLIPS,
  DrumClip,
  UndoHistory,
  addDrumClip,
  createDrumClipId,
  drumClipsEndBar,
  clipsUsingPattern,
  duplicateDrumClip,
  moveDrumClip,
  patternIdAtBar,
  setDrumClipPattern,
  removeDrumClip,
  resizeDrumClip,
} from './arrangement';
import { LoopRange } from './step-scheduler';
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

/** État de l'arrangement mémorisé par Annuler / Rétablir (positions et clips, jamais l'audio). */
export interface ArrangementSnapshot {
  readonly drumClips: readonly DrumClip[];
  readonly instrumentalStartBeat: number;
  /** Position de chaque prise (secondes), par identifiant. */
  readonly takeStarts: Readonly<Record<string, number>>;
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
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levelSource: MediaStreamAudioSourceNode | null = null;
  private lastClipAt = 0;
  private takeCounter = 0;

  /** BPM effectivement utilisé : une saisie invalide ne l'écrase jamais. */
  readonly bpm = signal(DEFAULT_BPM);
  /** Bibliothèque de patterns du projet (M3) ; chaque clip de batterie en joue un. */
  readonly patterns = signal<readonly PatternEntry[]>([{ id: DEFAULT_PATTERN_ID, name: 'Pattern 01', steps: createDemoPattern() }]);
  /** Pattern affiché et modifié dans le Drum Rack. */
  readonly editedPatternId = signal(DEFAULT_PATTERN_ID);
  readonly editedPattern = computed(() => this.patterns().find(entry => entry.id === this.editedPatternId()) ?? this.patterns()[0]);
  /** Grille du pattern édité. */
  readonly pattern = computed<DrumPattern>(() => this.editedPattern().steps);
  readonly transportState = signal<TransportState>('stopped');
  readonly playing = computed(() => this.transportState() === 'playing');
  /** Pas absolu de la tête de lecture (0 = début du morceau), conservé pendant une pause. */
  readonly songStep = signal(0);
  /** Pas en surbrillance dans le séquenceur, ou -1 à l'arrêt. */
  readonly currentStep = computed(() => (this.transportState() === 'stopped' ? -1 : this.songStep() % STEPS_PER_BAR));
  readonly metronome = signal(false);
  /** Lecture en boucle d'une plage de mesures (désactivée pendant un enregistrement). */
  readonly loopEnabled = signal(false);
  readonly loopBars = signal<LoopBars>(DEFAULT_LOOP_BARS);
  readonly loopRange = computed<LoopRange | null>(() =>
    this.loopEnabled() && validateLoopBars(this.loopBars()) === null ? loopStepRange(this.loopBars()) : null,
  );
  /** Clips de la piste Batterie (le pattern joue en boucle dans chacun). */
  readonly drumClips = signal<readonly DrumClip[]>(DEFAULT_DRUM_CLIPS);
  /** Début de l'instrumentale dans le morceau, en temps (beats) : suit les changements de BPM. */
  readonly instrumentalStartBeat = signal(0);
  private readonly history = new UndoHistory<ArrangementSnapshot>();
  /** Incrémenté à chaque modification de l'historique, pour rafraîchir les boutons. */
  private readonly historyVersion = signal(0);
  readonly canUndo = computed(() => (this.historyVersion(), this.history.canUndo));
  readonly canRedo = computed(() => (this.historyVersion(), this.history.canRedo));

  readonly instrumentalStartSeconds = computed(() => (this.instrumentalStartBeat() * 60) / this.bpm());
  /** Fin du contenu du morceau (pas absolu) : batterie, instrumentale, prises, et au moins 4 mesures. */
  readonly songEndStep = computed(() => {
    const stepSeconds = stepDurationSeconds(this.bpm());
    const loaded = this.instrumental();
    const instrumental = loaded ? this.instrumentalStartSeconds() + loaded.buffer.duration : 0;
    const takes = this.takes().map(take => take.startSeconds + take.buffer.duration);
    const lastSecond = Math.max(instrumental, ...takes, 0);
    const drumsEnd = drumClipsEndBar(this.drumClips()) * STEPS_PER_BAR;
    return clampSongStep(Math.max(4 * STEPS_PER_BAR, drumsEnd, Math.ceil(lastSecond / stepSeconds)));
  });
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

  /** Active ou retire une frappe (vélocité forte) dans le pattern édité. */
  toggleStep(voice: DrumVoice, step: number): void {
    if (step >= 0 && step < STEPS_PER_BAR) {
      this.updateEditedPattern(steps => toggleStep(steps, voice, step));
    }
  }

  /** Clic dans le Drum Rack : éteinte → forte → moyenne → douce → éteinte. */
  cycleStep(voice: DrumVoice, step: number): void {
    if (step >= 0 && step < STEPS_PER_BAR) {
      this.updateEditedPattern(steps => cycleStep(steps, voice, step));
    }
  }

  /** Décale toutes les frappes d'un instrument d'un pas (déplacer des frappes). */
  shiftRow(voice: DrumVoice, delta: number): void {
    this.updateEditedPattern(steps => shiftRow(steps, voice, delta));
  }

  // ——— Bibliothèque de patterns (M3) ———

  selectPattern(id: string): void {
    if (this.patterns().some(entry => entry.id === id)) {
      this.editedPatternId.set(id);
    }
  }

  /** Crée un pattern vide et l'ouvre dans le Drum Rack ; `null` si la limite est atteinte. */
  createPattern(): string | null {
    return this.insertPattern(createEmptyPattern());
  }

  /** Copie d'un pattern, pour créer une variante (refrain, break…). */
  duplicatePattern(id: string): string | null {
    const source = this.patterns().find(entry => entry.id === id);
    return source ? this.insertPattern(source.steps, `${source.name} (copie)`.slice(0, PATTERN_NAME_MAX_LENGTH)) : null;
  }

  renamePattern(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > PATTERN_NAME_MAX_LENGTH) {
      return false;
    }
    this.patterns.update(patterns => patterns.map(entry => (entry.id === id ? { ...entry, name: trimmed } : entry)));
    return true;
  }

  /** Supprime un pattern non utilisé. Renvoie un message si la suppression est refusée. */
  deletePattern(id: string): string | null {
    const patterns = this.patterns();
    if (patterns.length <= 1) {
      return 'Le projet garde au moins un pattern.';
    }
    const used = clipsUsingPattern(this.drumClips(), id);
    if (used > 0) {
      return `Ce pattern est joué par ${used} clip${used > 1 ? 's' : ''} : changez leur pattern ou supprimez-les d'abord.`;
    }
    const remaining = patterns.filter(entry => entry.id !== id);
    this.patterns.set(remaining);
    if (this.editedPatternId() === id) {
      this.editedPatternId.set(remaining[0].id);
    }
    return null;
  }

  /** Remplace la bibliothèque de patterns (ouverture d'un projet). */
  loadPatterns(patterns: readonly PatternEntry[]): void {
    const safe = patterns.length > 0 ? patterns : [{ id: DEFAULT_PATTERN_ID, name: 'Pattern 01', steps: createEmptyPattern() }];
    this.patterns.set(safe);
    this.editedPatternId.set(safe[0].id);
  }

  /** Pattern joué à un pas absolu, d'après les clips de batterie. */
  patternAt(songStep: number): DrumPattern | null {
    const id = patternIdAtBar(this.drumClips(), Math.floor(songStep / STEPS_PER_BAR));
    return id ? (this.patterns().find(entry => entry.id === id)?.steps ?? null) : null;
  }

  private insertPattern(steps: DrumPattern, name = nextPatternName(this.patterns())): string | null {
    if (this.patterns().length >= MAX_PATTERNS) {
      return null;
    }
    const id = createPatternId();
    this.patterns.update(patterns => [...patterns, { id, name, steps }]);
    this.editedPatternId.set(id);
    return id;
  }

  private updateEditedPattern(change: (steps: DrumPattern) => DrumPattern): void {
    const id = this.editedPattern().id;
    this.patterns.update(patterns => patterns.map(entry => (entry.id === id ? { ...entry, steps: change(entry.steps) } : entry)));
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

  /**
   * Place la tête de lecture sur un pas absolu. En lecture, la lecture repart de là ;
   * à l'arrêt, la position est gardée pour le prochain ▶. Sans effet pendant une prise.
   */
  async seek(songStep: number): Promise<void> {
    if (this.micState() !== 'idle') {
      return;
    }
    const step = clampSongStep(songStep);
    const wasPlaying = this.playing();
    this.haltTransport();
    this.songStep.set(step);
    this.transportState.set('paused');
    if (wasPlaying) {
      await this.startPlayback();
    }
  }

  /** Active ou règle la boucle ; une lecture en cours repart pour l'appliquer aussitôt. */
  async setLoop(change: { enabled?: boolean; bars?: LoopBars }): Promise<void> {
    if (change.bars) {
      this.loopBars.set(change.bars);
    }
    if (change.enabled !== undefined) {
      this.loopEnabled.set(change.enabled);
    }
    if (this.playing()) {
      await this.seek(this.songStep());
    }
  }

  // ——— Arrangement (M5) : chaque modification est annulable ———

  moveDrumClip(id: string, deltaBars: number): void {
    this.changeArrangement(() => this.drumClips.update(clips => moveDrumClip(clips, id, deltaBars)));
  }

  resizeDrumClip(id: string, deltaBars: number): void {
    this.changeArrangement(() => this.drumClips.update(clips => resizeDrumClip(clips, id, deltaBars)));
  }

  /** Renvoie l'identifiant de la copie, ou `null` si la limite est atteinte. */
  duplicateDrumClip(id: string): string | null {
    const newId = createDrumClipId();
    const next = duplicateDrumClip(this.drumClips(), id, newId);
    if (!next) {
      return null;
    }
    this.changeArrangement(() => this.drumClips.set(next));
    return newId;
  }

  /** Ajoute un clip de batterie à la mesure de la tête de lecture ; renvoie son identifiant. */
  addDrumClipAtPlayhead(): string | null {
    const newId = createDrumClipId();
    const next = addDrumClip(this.drumClips(), Math.floor(this.songStep() / STEPS_PER_BAR), newId, this.editedPattern().id);
    if (!next) {
      return null;
    }
    this.changeArrangement(() => this.drumClips.set(next));
    return newId;
  }

  /** Change le pattern joué par un clip (annulable). */
  setDrumClipPattern(id: string, patternId: string): void {
    if (this.patterns().some(entry => entry.id === patternId)) {
      this.changeArrangement(() => this.drumClips.update(clips => setDrumClipPattern(clips, id, patternId)));
    }
  }

  removeDrumClip(id: string): void {
    this.changeArrangement(() => this.drumClips.update(clips => removeDrumClip(clips, id)));
  }

  /** Déplace l'instrumentale par pas d'un temps ; elle ne commence jamais avant le morceau. */
  moveInstrumental(deltaBeats: number): void {
    const maxBeat = MAX_SONG_BARS * (STEPS_PER_BAR / STEPS_PER_BEAT);
    const next = Math.min(maxBeat, Math.max(0, Math.round(this.instrumentalStartBeat() + deltaBeats)));
    if (next !== this.instrumentalStartBeat()) {
      this.changeArrangement(() => this.instrumentalStartBeat.set(next));
    }
  }

  /** Déplace une prise d'un nombre de temps (au tempo courant). */
  moveTake(id: string, deltaBeats: number): void {
    this.changeArrangement(() => this.applyTakeShift(id, (deltaBeats * 60) / this.bpm(), false));
  }

  undo(): void {
    const previous = this.history.undo(this.arrangementSnapshot());
    if (previous) {
      this.restoreArrangement(previous);
    }
  }

  redo(): void {
    const next = this.history.redo(this.arrangementSnapshot());
    if (next) {
      this.restoreArrangement(next);
    }
  }

  /** Remplace l'arrangement (ouverture d'un projet) et vide l'historique. */
  loadArrangement(drumClips: readonly DrumClip[], instrumentalStartBeat: number): void {
    this.drumClips.set(drumClips);
    this.instrumentalStartBeat.set(instrumentalStartBeat);
    this.history.clear();
    this.historyVersion.update(version => version + 1);
  }

  private arrangementSnapshot(): ArrangementSnapshot {
    return {
      drumClips: this.drumClips(),
      instrumentalStartBeat: this.instrumentalStartBeat(),
      takeStarts: Object.fromEntries(this.takes().map(take => [take.id, take.startSeconds])),
    };
  }

  /** Mémorise l'état avant `change`, l'applique, puis relance la lecture pour l'entendre aussitôt. */
  private changeArrangement(change: () => void): void {
    const before = this.arrangementSnapshot();
    change();
    if (JSON.stringify(before) === JSON.stringify(this.arrangementSnapshot())) {
      return; // rien n'a bougé (borne atteinte) : pas d'entrée d'historique
    }
    this.history.record(before);
    this.historyVersion.update(version => version + 1);
    this.restartIfPlaying();
  }

  private restoreArrangement(snapshot: ArrangementSnapshot): void {
    this.drumClips.set(snapshot.drumClips);
    this.instrumentalStartBeat.set(snapshot.instrumentalStartBeat);
    // Une prise supprimée depuis n'est pas recréée : seules les positions sont restaurées.
    this.takes.update(takes =>
      takes.map(take => (snapshot.takeStarts[take.id] === undefined ? take : { ...take, startSeconds: snapshot.takeStarts[take.id] })),
    );
    this.historyVersion.update(version => version + 1);
    this.restartIfPlaying();
  }

  private restartIfPlaying(): void {
    if (this.playing()) {
      void this.seek(this.songStep());
    }
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
   * Annulable comme les autres modifications de l'arrangement.
   */
  shiftTake(id: string, deltaSeconds: number): number | null {
    if (!this.takes().some(take => take.id === id) || !Number.isFinite(deltaSeconds)) {
      return null;
    }
    this.changeArrangement(() => this.applyTakeShift(id, deltaSeconds, true));
    return this.takes().find(take => take.id === id)!.startSeconds;
  }

  /**
   * Décale une prise de `deltaSeconds`. `bounded` : correction de latence, limitée à
   * une seconde autour de la position enregistrée ; sinon déplacement dans le morceau.
   */
  private applyTakeShift(id: string, deltaSeconds: number, bounded: boolean): void {
    this.takes.update(takes =>
      takes.map(take => {
        if (take.id !== id) {
          return take;
        }
        const origin = take.recordedStartSeconds ?? take.startSeconds;
        const shifted = Math.round((take.startSeconds + deltaSeconds) * 1000) / 1000;
        const startSeconds = bounded
          ? Math.min(origin + MAX_TAKE_SHIFT_SECONDS, Math.max(origin - MAX_TAKE_SHIFT_SECONDS, shifted))
          : Math.max(-take.buffer.duration + 0.01, shifted);
        return { ...take, startSeconds, recordedStartSeconds: bounded ? origin : startSeconds };
      }),
    );
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
      const rendered = await renderMix({
        patternAt: step => this.patternAt(step),
        bpm: this.bpm(),
        bars,
        drumsGain: gains.drums,
        clips,
      });
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
      this.transport ??= new PatternTransport(
        context,
        master,
        songStep => this.patternAt(songStep),
        () => this.bpm(),
        () => this.metronome(),
      );
      // Pas de boucle pendant une prise : la voix doit suivre le morceau de façon linéaire.
      const loop = includeTake ? this.loopRange() : null;
      let fromSongStep = this.transportState() === 'paused' ? this.songStep() : 0;
      if (loop && (fromSongStep < loop.startStep || fromSongStep >= loop.endStep)) {
        fromSongStep = loop.startStep;
      }
      this.transport.play(
        { clips: this.trackClips(includeTake), gains: effectiveTrackGains(this.mixer()), fromSongStep, instrumentalEq: this.instrumentalEq(), loop },
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
      clips.push({ track: 'instrumental', clip: { buffer: instrumental.buffer, startSeconds: this.instrumentalStartSeconds(), gain: INSTRUMENTAL_GAIN } });
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
