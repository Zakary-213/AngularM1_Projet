import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AudioEngineService } from '../audio/audio-engine.service';
import { StudioSessionService, VocalTake } from '../audio/studio-session.service';
import { recordingFileFormat } from '../audio/microphone-recorder';
import { InstrumentalRef, StudioState, TakeCorrectionRef, TakeRef, contentFingerprint, fromProject, secondsToBeats, toProjectContent } from '../audio/project-mapping';
import { migrateUserStyles } from '../audio/pitch/voice-correction-state';
import { readStoredUserStylesJson } from '../audio/pitch/user-styles-storage';
import { encodeWav } from '../audio/wav-encoder';
import { MusicalProject, PROJECT_FORMAT_VERSION } from '../models/musical-project.model';
import type { ProjectLyrics } from '../models/lyrics.model';
import { ProjectService } from './project.service';
import { TrackService } from './track.service';
import type { VocalTrackId } from '../audio/track-mix';

export type ProjectLoadState = 'loading' | 'loaded' | 'error';
/** `dirty` : modifié localement ; `saved` : confirmé par le serveur ; `conflict` : modifié ailleurs. */
export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/** Envoi de l'instrumentale vers la bibliothèque (progression en %, de 0 à 100). */
export type InstrumentalUpload =
  | { readonly state: 'idle' }
  | { readonly state: 'uploading'; readonly progress: number }
  | { readonly state: 'error'; readonly message: string };

/** Envoi d'une prise vocale : en cours (avec progression) ou en échec. Absente : rien en cours. */
export type TakeUpload = { readonly state: 'uploading'; readonly progress: number } | { readonly state: 'error'; readonly message: string };

/** Récupération du fichier de l'instrumentale à l'ouverture d'un projet. */
export type InstrumentalDownload = 'idle' | 'loading' | 'error';

/**
 * Délai de la sauvegarde automatique après la dernière modification (ms) : une série
 * de réglages (curseur, déplacements de clips) part en une seule requête.
 */
export const AUTO_SAVE_DELAY_MS = 2000;
/**
 * Projet ouvert dans le studio : chargement, état de sauvegarde, sauvegarde explicite
 * et automatique (M10), ainsi que l'envoi et la récupération des fichiers audio :
 * instrumentale (M6), prises (M8) et version corrigée de la prise active (M9/M10).
 * Fourni par la page Studio, à côté de `StudioSessionService` dont il lit et
 * remplit l'état. Sans projet ouvert (`/studio`), l'instrumentale reste locale.
 */
@Injectable()
export class StudioProjectService {
  private readonly projects = inject(ProjectService);
  private readonly tracks = inject(TrackService);
  private readonly engine = inject(AudioEngineService);
  private readonly session = inject(StudioSessionService);

  readonly project = signal<MusicalProject | null>(null);
  readonly projectLoadVersion = signal(0);
  readonly lyrics = signal<ProjectLyrics | undefined>(undefined);
  readonly loadState = signal<ProjectLoadState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  private readonly savedFingerprint = signal<string | null>(null);

  /** Instrumentale telle qu'elle sera sauvegardée : seulement un fichier déjà envoyé au serveur. */
  readonly instrumentalRef = signal<InstrumentalRef | null>(null);
  readonly upload = signal<InstrumentalUpload>({ state: 'idle' });
  readonly download = signal<InstrumentalDownload>('idle');
  readonly downloadError = signal<string | null>(null);
  /** Dernier fichier choisi, gardé pour un nouvel essai d'envoi. */
  private pendingFile: { file: File; buffer: AudioBuffer } | null = null;

  /** Prises telles qu'elles seront sauvegardées : seulement celles déjà envoyées au serveur. */
  readonly takeRefs = signal<TakeRef[]>([]);
  /** État d'envoi par identifiant de prise. */
  readonly takeUploads = signal<Readonly<Record<string, TakeUpload>>>({});
  /** Prises du projet qui n'ont pas pu être récupérées, par identifiant (message à afficher). */
  readonly takeErrors = signal<Readonly<Record<string, string>>>({});
  readonly takesLoading = signal(0);

  /** Version corrigée de la prise active telle qu'elle sera sauvegardée (fichier déjà envoyé). */
  private readonly correctionRefs = signal<Readonly<Record<string, Omit<TakeCorrectionRef, 'enabled'>>>>({});
  readonly correctionRef = computed(() => this.correctionRefs()[this.session.activeTakeId() ?? ''] ?? null);
  readonly correctionUpload = signal<TakeUpload | null>(null);
  /** Version corrigée du projet impossible à récupérer à l'ouverture. */
  readonly correctionError = signal<string | null>(null);
  /** Dernière version corrigée choisie, gardée pour un nouvel essai d'envoi. */
  private pendingCorrection: { takeId: string; buffer: AudioBuffer; styleLabel: string } | null = null;

  /** Sauvegarde automatique, différée de AUTO_SAVE_DELAY_MS après la dernière modification. */
  readonly autoSave = signal(true);
  /** Empreinte dont la sauvegarde automatique a échoué : pas de nouvel essai tant que rien ne change. */
  private failedFingerprint: string | null = null;

  readonly uploading = computed(
    () =>
      this.upload().state === 'uploading' ||
      this.correctionUpload()?.state === 'uploading' ||
      Object.values(this.takeUploads()).some(upload => upload.state === 'uploading'),
  );

  private readonly currentState = computed<StudioState>(() => {
    const ref = this.instrumentalRef();
    const loaded = this.session.instrumental();
    const bpm = this.session.bpm();
    return {
      instrumentTracks: this.session.instrumentTracks(),
      vocalTracks: this.session.vocalTracks(),
      armedVocalTrackId: this.session.armedVocalTrackId(),
      corrections: Object.values(this.correctionRefs()).map(ref => ({ ...ref, enabled: this.session.enabledCorrections()[ref.takeId] === true })),
      lyrics: this.lyrics(),
      bpm,
      key: this.session.projectKey(),
      patterns: this.session.patterns(),
      mixer: this.session.mixer(),
      // Durée recalculée depuis le fichier quand il est chargé : elle suit le tempo courant.
      instrumental: ref && loaded?.fileId === ref.fileId ? { ...ref, durationBeats: secondsToBeats(loaded.buffer.duration, bpm) } : ref,
      masterVolume: this.session.masterVolume(),
      // Position courante de chaque prise chargée (déplacée ou décalée depuis l'envoi).
      takes: this.takeRefs().map(ref => {
        const take = this.session.takes().find(candidate => candidate.id === ref.id);
        return take ? { ...ref, startSeconds: take.startSeconds } : ref;
      }),
      activeTakeId: this.takeRefs().some(take => take.id === this.session.activeTakeId()) ? this.session.activeTakeId() : null,
      drumClips: this.session.drumClips(),
      instrumentalStartBeat: this.session.instrumentalStartBeat(),
      melodicPatterns: this.session.melodicPatterns(),
      instrumentClips: this.session.instrumentClips(),
      vocal: this.session.vocalTracks()[0].settings,
      userStyles: this.session.userVocalStyles(),
      correction: this.currentCorrection(),
    };
  });

  /** La version corrigée envoyée ne vaut que pour la prise active ; son choix suit la piste Voix. */
  private readonly currentCorrection = computed<TakeCorrectionRef | null>(() => {
    const ref = this.correctionRef();
    return ref && ref.takeId === this.session.activeTakeId() ? { ...ref, enabled: this.session.useCorrectedTake() } : null;
  });

  private readonly currentFingerprint = computed(() => contentFingerprint(this.currentState()));

  readonly hasUnsavedChanges = computed(() => this.project() !== null && this.savedFingerprint() !== this.currentFingerprint());

  readonly saveState = computed<ProjectSaveState>(() => {
    if (this.conflict()) return 'conflict';
    if (this.saving()) return 'saving';
    if (this.saveError()) return 'error';
    return this.hasUnsavedChanges() ? 'dirty' : 'saved';
  });

  /** Sauvegarde possible : modifications présentes, aucun envoi de fichier ni sauvegarde en cours. */
  readonly canSave = computed(() => this.hasUnsavedChanges() && !this.saving() && !this.conflict() && !this.uploading());

  constructor() {
    // Sauvegarde automatique : chaque modification relance le délai, les mouvements de
    // curseur rapprochés ne produisent donc qu'une requête. Jamais pendant un conflit
    // ni un envoi de fichier ; après un échec, elle attend une nouvelle modification.
    effect(onCleanup => {
      const fingerprint = this.currentFingerprint();
      if (!this.autoSave() || !this.canSave() || (this.saveError() && fingerprint === this.failedFingerprint)) {
        return;
      }
      const timer = setTimeout(() => untracked(() => this.save()), AUTO_SAVE_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  load(id: string): void {
    this.projectLoadVersion.update(version => version + 1);
    this.loadState.set('loading');
    this.loadError.set(null);
    this.conflict.set(false);
    this.saveError.set(null);
    this.projects.get(id).subscribe({
      next: project => {
        if (project.formatVersion > PROJECT_FORMAT_VERSION) {
          // Ne pas l'ouvrir : une sauvegarde depuis cette version perdrait des données.
          console.warn('[studio-project] format non pris en charge', { id, formatVersion: project.formatVersion });
          this.fail('Ce projet a été enregistré par une version plus récente du studio : il ne peut pas être ouvert ici.');
          return;
        }
        this.apply(project);
        this.loadState.set('loaded');
        console.log('[studio-project] projet chargé', { id, revision: project.revision });
      },
      error: (error: unknown) => {
        console.error('[studio-project] chargement impossible', error);
        this.fail(error instanceof HttpErrorResponse && error.status === 404 ? 'Projet introuvable ou non autorisé.' : 'Le projet n’a pas pu être chargé.');
      },
    });
  }

  save(): void {
    const project = this.project();
    if (!project || this.saving() || this.conflict() || this.uploading()) {
      return;
    }
    const state = this.currentState();
    const fingerprint = contentFingerprint(state);
    this.saving.set(true);
    this.saveError.set(null);
    this.projects.save(project.id, project.revision, toProjectContent(state)).subscribe({
      next: saved => {
        this.project.set(saved);
        // Empreinte de l'état envoyé : une modification faite pendant la requête reste « non sauvegardée ».
        this.savedFingerprint.set(fingerprint);
        this.failedFingerprint = null;
        this.saving.set(false);
        console.log('[studio-project] projet sauvegardé', { id: saved.id, revision: saved.revision });
      },
      error: (error: unknown) => {
        console.error('[studio-project] sauvegarde impossible', error);
        this.saving.set(false);
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.conflict.set(true);
          return;
        }
        this.failedFingerprint = fingerprint;
        this.saveError.set(this.saveErrorMessage(error));
      },
    });
  }

  /** Abandonne les modifications locales et recharge la version du serveur (après un conflit). */
  reload(): void {
    const project = this.project();
    if (project && this.session.micState() === 'idle') {
      this.load(project.id);
    }
  }

  /**
   * Installe une instrumentale locale ; dans un projet, l'envoie aussi à la bibliothèque.
   * L'écoute est possible tout de suite, la référence n'est sauvegardée qu'après l'envoi.
   */
  async importInstrumental(file: File): Promise<void> {
    if (this.uploading()) {
      return;
    }
    const ok = await this.session.importInstrumental(file);
    const loaded = this.session.instrumental();
    if (!ok || !loaded || !this.project()) {
      return;
    }
    this.pendingFile = { file, buffer: loaded.buffer };
    this.sendPendingFile();
  }

  retryUpload(): void {
    if (this.pendingFile && !this.uploading()) {
      this.sendPendingFile();
    }
  }

  /** Retire l'instrumentale du projet. Le fichier reste dans la bibliothèque (page Fichiers audio). */
  removeInstrumental(): void {
    if (this.uploading()) {
      return;
    }
    this.pendingFile = null;
    this.upload.set({ state: 'idle' });
    this.downloadError.set(null);
    this.download.set('idle');
    this.session.setInstrumental(null);
    this.instrumentalRef.set(null);
  }

  /** Nouvel essai de récupération du fichier de l'instrumentale (après une erreur réseau). */
  retryDownload(): void {
    const ref = this.instrumentalRef();
    if (ref && this.download() !== 'loading') {
      this.fetchInstrumental(ref);
    }
  }

  /** Termine la prise en cours ; dans un projet, l'envoie aussitôt à la bibliothèque. */
  async stopRecording(): Promise<void> {
    const previous = this.session.lastRecordedTake();
    await this.session.stopRecording();
    const take = this.session.lastRecordedTake();
    if (take && take !== previous && this.project()) {
      this.sendTake(take);
    }
  }

  retryTakeUpload(id: string): void {
    const take = this.session.takes().find(candidate => candidate.id === id);
    if (take && this.takeUploads()[id]?.state === 'error') {
      this.sendTake(take);
    }
  }

  selectTake(id: string): void {
    this.session.selectTake(id);
  }

  removeVocalTrack(trackId: VocalTrackId): boolean {
    if (this.uploading()) return false;
    const takeIds = new Set([
      ...this.takeRefs().filter(ref => (ref.trackId ?? 'voice') === trackId).map(ref => ref.id),
      ...this.session.takes().filter(take => (take.trackId ?? 'voice') === trackId).map(take => take.id),
    ]);
    if (!this.session.removeVocalTrack(trackId)) return false;
    this.takeRefs.update(refs => refs.filter(ref => !takeIds.has(ref.id)));
    this.takeUploads.update(values => Object.fromEntries(Object.entries(values).filter(([id]) => !takeIds.has(id))));
    this.takeErrors.update(values => Object.fromEntries(Object.entries(values).filter(([id]) => !takeIds.has(id))));
    this.correctionRefs.update(values => Object.fromEntries(Object.entries(values).filter(([id]) => !takeIds.has(id))));
    if (this.pendingCorrection && takeIds.has(this.pendingCorrection.takeId)) {
      this.pendingCorrection = null;
      this.correctionUpload.set(null);
    }
    return true;
  }

  renameTake(id: string, name: string): boolean {
    if (!this.session.renameTake(id, name)) {
      return false;
    }
    const label = this.session.takes().find(take => take.id === id)!.name;
    this.takeRefs.update(refs => refs.map(ref => (ref.id === id ? { ...ref, label } : ref)));
    return true;
  }

  /** Décale une prise ; la position sauvegardée suit si la prise est déjà envoyée. */
  shiftTake(id: string, deltaSeconds: number): void {
    const startSeconds = this.session.shiftTake(id, deltaSeconds);
    if (startSeconds !== null) {
      this.takeRefs.update(refs => refs.map(ref => (ref.id === id ? { ...ref, startSeconds } : ref)));
    }
  }

  /** Retire une prise du projet. Son fichier reste dans la bibliothèque (page Fichiers audio). */
  removeTake(id: string): void {
    if (this.takeUploads()[id]?.state === 'uploading' || this.session.micState() !== 'idle') {
      return;
    }
    this.session.removeTake(id);
    this.takeRefs.update(refs => refs.filter(ref => ref.id !== id));
    this.takeUploads.update(({ [id]: _removed, ...rest }) => rest);
    this.takeErrors.update(({ [id]: _removed, ...rest }) => rest);
    this.correctionRefs.update(({ [id]: _removed, ...rest }) => rest);
    this.session.vocalTracks.update(tracks => tracks.map(track => track.activeTakeId === id
      ? { ...track, activeTakeId: this.takeRefs().filter(ref => (ref.trackId ?? 'voice') === track.id).at(-1)?.id ?? null }
      : track));
    if (this.pendingCorrection?.takeId === id) {
      this.pendingCorrection = null;
      this.correctionUpload.set(null);
    }
  }

  /**
   * Joue la version corrigée sur la piste Voix ; dans un projet, l'envoie aussi à la
   * bibliothèque (WAV mono) pour la sauvegarder avec la prise. L'original n'est pas modifié.
   */
  useCorrectedVersion(buffer: AudioBuffer, styleLabel: string): void {
    const takeId = this.session.activeTakeId();
    if (!takeId || this.correctionUpload()?.state === 'uploading') {
      return;
    }
    this.session.setCorrectedTake({ takeId, buffer, styleLabel });
    this.session.setUseCorrectedTake(true);
    this.correctionError.set(null);
    if (!this.project()) {
      return;
    }
    this.pendingCorrection = { takeId, buffer, styleLabel };
    this.sendCorrection();
  }

  retryCorrectionUpload(): void {
    if (this.pendingCorrection && this.correctionUpload()?.state === 'error') {
      this.sendCorrection();
    }
  }

  private sendCorrection(): void {
    const pending = this.pendingCorrection;
    const take = this.session.takes().find(candidate => candidate.id === pending?.takeId);
    if (!pending || !take) {
      return;
    }
    const wav = new Blob([encodeWav([pending.buffer.getChannelData(0)], pending.buffer.sampleRate)], { type: 'audio/wav' });
    const file = new File([wav], `${take.name} (corrigée).wav`, { type: 'audio/wav' });
    this.correctionUpload.set({ state: 'uploading', progress: 0 });
    this.tracks.upload(file, `${take.name} · corrigée (${pending.styleLabel}) · ${this.project()?.title ?? 'Studio'}`).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) {
          this.correctionUpload.set({ state: 'uploading', progress: event.total ? Math.round((100 * event.loaded) / event.total) : 0 });
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) {
          return;
        }
        this.correctionUpload.set(null);
        // Remplacée ou abandonnée (autre prise active) pendant l'envoi : le fichier reste dans la bibliothèque.
        if (this.pendingCorrection !== pending || !this.session.takes().some(candidate => candidate.id === pending.takeId)) {
          return;
        }
        this.pendingCorrection = null;
        const ref = { takeId: pending.takeId, fileId: event.body.id, styleLabel: pending.styleLabel };
        this.correctionRefs.update(refs => ({ ...refs, [ref.takeId]: ref }));
        console.log('[studio-project] version corrigée envoyée', { takeId: pending.takeId, fileId: event.body.id });
      },
      error: (error: unknown) => {
        console.error('[studio-project] envoi de la version corrigée impossible', error);
        this.correctionUpload.set({ state: 'error', message: this.uploadErrorMessage(error) });
      },
    });
  }

  private fetchCorrection(ref: Omit<TakeCorrectionRef, 'enabled'>): void {
    const loadVersion = this.projectLoadVersion();
    this.takesLoading.update(count => count + 1);
    this.tracks.audio(ref.fileId).subscribe({
      next: blob => {
        void this.decodeCorrection(ref, blob, loadVersion);
      },
      error: (error: unknown) => {
        if (this.projectLoadVersion() !== loadVersion) return;
        this.takesLoading.update(count => count - 1);
        if (!this.correctionRefs()[ref.takeId]) return;
        console.error('[studio-project] version corrigée introuvable', error);
        this.correctionError.set(
          error instanceof HttpErrorResponse && error.status === 404
            ? 'La version corrigée de la prise n’existe plus dans votre bibliothèque : la prise originale est jouée.'
            : 'La version corrigée de la prise n’a pas pu être récupérée : la prise originale est jouée.',
        );
      },
    });
  }

  private async decodeCorrection(ref: Omit<TakeCorrectionRef, 'enabled'>, blob: Blob, loadVersion: number): Promise<void> {
    try {
      const buffer = await this.engine.decode(await blob.arrayBuffer());
      // Ignorée si la prise active ou la version corrigée ont changé entre-temps.
      if (this.projectLoadVersion() === loadVersion && this.correctionRefs()[ref.takeId]?.fileId === ref.fileId) {
        this.session.setCorrectedTake({ takeId: ref.takeId, buffer, styleLabel: ref.styleLabel });
      }
    } catch (error) {
      if (this.projectLoadVersion() !== loadVersion || !this.correctionRefs()[ref.takeId]) return;
      console.error('[studio-project] décodage de la version corrigée impossible', error);
      this.correctionError.set('La version corrigée ne peut pas être décodée par ce navigateur : la prise originale est jouée.');
    } finally {
      if (loadVersion === this.projectLoadVersion()) this.takesLoading.update(count => count - 1);
    }
  }

  private sendTake(take: VocalTake): void {
    const { type, extension } = recordingFileFormat(take.mimeType);
    // Nom de fichier indicatif : le serveur génère son propre nom de stockage.
    const file = new File([take.blob], `${take.name}.${extension}`, { type });
    const title = `${take.name} · ${this.project()?.title ?? 'Studio'}`;
    this.setTakeUpload(take.id, { state: 'uploading', progress: 0 });
    this.tracks.upload(file, title).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) {
          this.setTakeUpload(take.id, { state: 'uploading', progress: event.total ? Math.round((100 * event.loaded) / event.total) : 0 });
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) {
          return;
        }
        const fileId = event.body.id;
        this.setTakeUpload(take.id, null);
        // Supprimée pendant l'envoi : le fichier reste dans la bibliothèque, mais pas dans le projet.
        const current = this.session.takes().find(candidate => candidate.id === take.id);
        if (!current) {
          return;
        }
        this.session.markTakeUploaded(take.id, fileId);
        this.takeRefs.update(refs => [
          ...refs,
          { id: take.id, trackId: take.trackId, fileId, label: current.name, startSeconds: current.startSeconds, durationSeconds: take.buffer.duration },
        ]);
        console.log('[studio-project] prise envoyée', { id: take.id, fileId });
      },
      error: (error: unknown) => {
        console.error('[studio-project] envoi de la prise impossible', error);
        this.setTakeUpload(take.id, { state: 'error', message: this.uploadErrorMessage(error) });
      },
    });
  }

  private setTakeUpload(id: string, upload: TakeUpload | null): void {
    this.takeUploads.update(({ [id]: _previous, ...rest }) => (upload ? { ...rest, [id]: upload } : rest));
  }

  private fetchTake(ref: TakeRef, order: readonly string[]): void {
    const loadVersion = this.projectLoadVersion();
    this.takesLoading.update(count => count + 1);
    this.tracks.audio(ref.fileId).subscribe({
      next: blob => {
        void this.decodeTake(ref, blob, order, loadVersion);
      },
      error: (error: unknown) => {
        if (loadVersion !== this.projectLoadVersion()) return;
        console.error('[studio-project] prise introuvable', error);
        this.takesLoading.update(count => count - 1);
        if (!this.takeRefs().some(candidate => candidate.id === ref.id)) return;
        this.takeErrors.update(errors => ({
          ...errors,
          [ref.id]:
            error instanceof HttpErrorResponse && error.status === 404
              ? `« ${ref.label} » n’existe plus dans votre bibliothèque.`
              : `« ${ref.label} » n’a pas pu être récupérée.`,
        }));
      },
    });
  }

  private async decodeTake(ref: TakeRef, blob: Blob, order: readonly string[], loadVersion: number): Promise<void> {
    try {
      const buffer = await this.engine.decode(await blob.arrayBuffer());
      if (loadVersion === this.projectLoadVersion() && this.takeRefs().some(candidate => candidate.id === ref.id)) {
        this.session.restoreTake(
          { id: ref.id, trackId: ref.trackId, name: ref.label, blob, fileId: ref.fileId, buffer, url: URL.createObjectURL(blob), mimeType: blob.type, startSeconds: ref.startSeconds, latencyMs: 0 },
          order,
        );
      }
    } catch (error) {
      if (loadVersion !== this.projectLoadVersion() || !this.takeRefs().some(candidate => candidate.id === ref.id)) return;
      console.error('[studio-project] décodage de la prise impossible', error);
      this.takeErrors.update(errors => ({ ...errors, [ref.id]: `« ${ref.label} » ne peut pas être décodée par ce navigateur.` }));
    } finally {
      if (loadVersion === this.projectLoadVersion()) this.takesLoading.update(count => count - 1);
    }
  }

  private sendPendingFile(): void {
    const pending = this.pendingFile;
    if (!pending) {
      return;
    }
    this.upload.set({ state: 'uploading', progress: 0 });
    this.tracks.upload(pending.file, pending.file.name).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
          this.upload.set({ state: 'uploading', progress });
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) {
          return;
        }
        const fileId = event.body.id;
        this.session.markInstrumentalUploaded(pending.buffer, fileId);
        this.instrumentalRef.set({
          fileId,
          label: pending.file.name,
          durationBeats: secondsToBeats(pending.buffer.duration, this.session.bpm()),
        });
        this.pendingFile = null;
        this.upload.set({ state: 'idle' });
        console.log('[studio-project] instrumentale envoyée', { fileId });
      },
      error: (error: unknown) => {
        console.error('[studio-project] envoi de l’instrumentale impossible', error);
        this.upload.set({ state: 'error', message: this.uploadErrorMessage(error) });
      },
    });
  }

  private fetchInstrumental(ref: InstrumentalRef): void {
    this.download.set('loading');
    this.downloadError.set(null);
    this.tracks.audio(ref.fileId).subscribe({
      next: blob => {
        void this.decodeDownloaded(ref, blob);
      },
      error: (error: unknown) => {
        console.error('[studio-project] instrumentale introuvable', error);
        this.download.set('error');
        this.downloadError.set(
          error instanceof HttpErrorResponse && error.status === 404
            ? `Le fichier « ${ref.label} » n’existe plus dans votre bibliothèque. Retirez-le ou importez-en un autre.`
            : 'L’instrumentale n’a pas pu être récupérée. Réessayez.',
        );
      },
    });
  }

  private async decodeDownloaded(ref: InstrumentalRef, blob: Blob): Promise<void> {
    try {
      const buffer = await this.engine.decode(await blob.arrayBuffer());
      // Ignorée si l'utilisateur a retiré ou remplacé l'instrumentale entre-temps.
      if (this.instrumentalRef()?.fileId === ref.fileId) {
        this.session.setInstrumental({ name: ref.label, buffer, fileId: ref.fileId });
      }
      this.download.set('idle');
    } catch (error) {
      console.error('[studio-project] décodage de l’instrumentale impossible', error);
      this.download.set('error');
      this.downloadError.set(`Le fichier « ${ref.label} » ne peut pas être décodé par ce navigateur.`);
    }
  }

  private apply(project: MusicalProject): void {
    this.session.stopPlayback();
    const state = fromProject(project);
    this.lyrics.set(state.lyrics);
    this.session.setBpm(state.bpm);
    this.session.projectKey.set(state.key);
    this.session.loadPatterns(state.patterns);
    this.session.loadMelodicPatterns(state.melodicPatterns);
    this.session.instrumentTracks.set(state.instrumentTracks);
    this.session.selectedInstrumentTrackId.set(null);
    this.session.instrumentPickerTarget.set(null);
    this.session.mixer.set(state.mixer);
    this.session.masterVolume.set(state.masterVolume);
    this.session.loadArrangement(state.drumClips, state.instrumentalStartBeat, state.instrumentClips);
    // Projet antérieur à la M10 : il reprend les styles personnels gardés dans ce navigateur
    // (ils deviennent une modification à sauvegarder).
    this.session.userVocalStyles.set(migrateUserStyles(project.vocal, state.userStyles, readStoredUserStylesJson()));
    this.session.setInstrumental(null);
    this.pendingFile = null;
    this.upload.set({ state: 'idle' });
    this.download.set('idle');
    this.downloadError.set(null);
    this.instrumentalRef.set(state.instrumental);
    this.session.clearTakes();
    this.session.vocalTracks.set(state.vocalTracks!);
    this.session.armedVocalTrackId.set(state.armedVocalTrackId!);
    const corrections = state.corrections ?? [];
    this.correctionRefs.set(Object.fromEntries(corrections.map(({ enabled: _enabled, ...ref }) => [ref.takeId, ref])));
    this.session.enabledCorrections.set(Object.fromEntries(corrections.map(ref => [ref.takeId, ref.enabled])));
    this.correctionUpload.set(null);
    this.correctionError.set(null);
    this.pendingCorrection = null;
    this.failedFingerprint = null;
    this.takeRefs.set([...state.takes]);
    this.takesLoading.set(0);
    this.takeUploads.set({});
    this.takeErrors.set({});
    this.project.set(project);
    this.savedFingerprint.set(contentFingerprint(state));
    if (state.instrumental) {
      this.fetchInstrumental(state.instrumental);
    }
    const order = state.takes.map(take => take.id);
    state.takes.forEach(take => this.fetchTake(take, order));
    corrections.forEach(ref => this.fetchCorrection(ref));
  }

  private fail(message: string): void {
    this.project.set(null);
    this.loadError.set(message);
    this.loadState.set('error');
  }

  private uploadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0 || error.status >= 500) return 'Envoi impossible : serveur injoignable. L’instrumentale reste écoutable ici ; réessayez.';
      if (error.status === 413) return 'Fichier trop lourd pour le serveur (25 Mo maximum).';
      const message = (error.error as { message?: unknown } | null)?.message;
      if (error.status === 400 && typeof message === 'string') return `Envoi refusé : ${message}`;
    }
    return 'L’envoi de l’instrumentale a échoué. Réessayez.';
  }

  private saveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0 || error.status >= 500) return 'Serveur injoignable : vos modifications sont conservées ici, réessayez.';
      if (error.status === 404) return 'Ce projet n’existe plus ou ne vous appartient pas.';
      if (error.status === 422) return 'Format de projet non pris en charge : sauvegarde refusée.';
      const message = (error.error as { message?: unknown } | null)?.message;
      if (error.status === 400 && typeof message === 'string') return `Sauvegarde refusée : ${message}`;
    }
    return 'La sauvegarde a échoué. Réessayez.';
  }
}
