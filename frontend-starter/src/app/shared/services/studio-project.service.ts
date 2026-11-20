import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioEngineService } from '../audio/audio-engine.service';
import { StudioSessionService, VocalTake } from '../audio/studio-session.service';
import { recordingFileFormat } from '../audio/microphone-recorder';
import { InstrumentalRef, StudioState, TakeRef, contentFingerprint, fromProject, secondsToBeats, toProjectContent } from '../audio/project-mapping';
import { MusicalProject, PROJECT_FORMAT_VERSION } from '../models/musical-project.model';
import { ProjectService } from './project.service';
import { TrackService } from './track.service';

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
 * Projet ouvert dans le studio : chargement, état de sauvegarde et sauvegarde,
 * ainsi que l'envoi et la récupération du fichier de l'instrumentale (M6).
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

  readonly uploading = computed(
    () => this.upload().state === 'uploading' || Object.values(this.takeUploads()).some(upload => upload.state === 'uploading'),
  );

  private readonly currentState = computed<StudioState>(() => {
    const ref = this.instrumentalRef();
    const loaded = this.session.instrumental();
    const bpm = this.session.bpm();
    return {
      bpm,
      key: this.session.projectKey(),
      pattern: this.session.pattern(),
      mixer: this.session.mixer(),
      // Durée recalculée depuis le fichier quand il est chargé : elle suit le tempo courant.
      instrumental: ref && loaded?.fileId === ref.fileId ? { ...ref, durationBeats: secondsToBeats(loaded.buffer.duration, bpm) } : ref,
      instrumentalEq: this.session.instrumentalEq(),
      // Position courante de chaque prise chargée (déplacée ou décalée depuis l'envoi).
      takes: this.takeRefs().map(ref => {
        const take = this.session.takes().find(candidate => candidate.id === ref.id);
        return take ? { ...ref, startSeconds: take.startSeconds } : ref;
      }),
      activeTakeId: this.takeRefs().some(take => take.id === this.session.activeTakeId()) ? this.session.activeTakeId() : null,
      drumClips: this.session.drumClips(),
      instrumentalStartBeat: this.session.instrumentalStartBeat(),
    };
  });

  readonly hasUnsavedChanges = computed(
    () => this.project() !== null && this.savedFingerprint() !== contentFingerprint(this.currentState()),
  );

  readonly saveState = computed<ProjectSaveState>(() => {
    if (this.conflict()) return 'conflict';
    if (this.saving()) return 'saving';
    if (this.saveError()) return 'error';
    return this.hasUnsavedChanges() ? 'dirty' : 'saved';
  });

  /** Sauvegarde possible : modifications présentes, aucun envoi de fichier ni sauvegarde en cours. */
  readonly canSave = computed(() => this.hasUnsavedChanges() && !this.saving() && !this.conflict() && !this.uploading());

  load(id: string): void {
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
    this.saving.set(true);
    this.saveError.set(null);
    this.projects.save(project.id, project.revision, toProjectContent(state)).subscribe({
      next: saved => {
        this.project.set(saved);
        // Empreinte de l'état envoyé : une modification faite pendant la requête reste « non sauvegardée ».
        this.savedFingerprint.set(contentFingerprint(state));
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
        this.saveError.set(this.saveErrorMessage(error));
      },
    });
  }

  /** Abandonne les modifications locales et recharge la version du serveur (après un conflit). */
  reload(): void {
    const project = this.project();
    if (project) {
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
    if (this.takeUploads()[id]?.state === 'uploading') {
      return;
    }
    this.session.removeTake(id);
    this.takeRefs.update(refs => refs.filter(ref => ref.id !== id));
    this.takeUploads.update(({ [id]: _removed, ...rest }) => rest);
    this.takeErrors.update(({ [id]: _removed, ...rest }) => rest);
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
          { id: take.id, fileId, label: current.name, startSeconds: current.startSeconds, durationSeconds: take.buffer.duration },
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
    this.takesLoading.update(count => count + 1);
    this.tracks.audio(ref.fileId).subscribe({
      next: blob => {
        void this.decodeTake(ref, blob, order);
      },
      error: (error: unknown) => {
        console.error('[studio-project] prise introuvable', error);
        this.takesLoading.update(count => count - 1);
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

  private async decodeTake(ref: TakeRef, blob: Blob, order: readonly string[]): Promise<void> {
    try {
      const buffer = await this.engine.decode(await blob.arrayBuffer());
      if (this.takeRefs().some(candidate => candidate.id === ref.id)) {
        this.session.restoreTake(
          { id: ref.id, name: ref.label, blob, fileId: ref.fileId, buffer, url: URL.createObjectURL(blob), mimeType: blob.type, startSeconds: ref.startSeconds, latencyMs: 0 },
          order,
        );
      }
    } catch (error) {
      console.error('[studio-project] décodage de la prise impossible', error);
      this.takeErrors.update(errors => ({ ...errors, [ref.id]: `« ${ref.label} » ne peut pas être décodée par ce navigateur.` }));
    } finally {
      this.takesLoading.update(count => count - 1);
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
    const state = fromProject(project);
    this.session.setBpm(state.bpm);
    this.session.projectKey.set(state.key);
    this.session.pattern.set(state.pattern);
    this.session.mixer.set(state.mixer);
    this.session.instrumentalEq.set(state.instrumentalEq);
    this.session.loadArrangement(state.drumClips, state.instrumentalStartBeat);
    this.session.setInstrumental(null);
    this.pendingFile = null;
    this.upload.set({ state: 'idle' });
    this.download.set('idle');
    this.downloadError.set(null);
    this.instrumentalRef.set(state.instrumental);
    this.session.clearTakes(state.activeTakeId);
    this.takeRefs.set([...state.takes]);
    this.takeUploads.set({});
    this.takeErrors.set({});
    this.project.set(project);
    this.savedFingerprint.set(contentFingerprint(state));
    if (state.instrumental) {
      this.fetchInstrumental(state.instrumental);
    }
    const order = state.takes.map(take => take.id);
    state.takes.forEach(take => this.fetchTake(take, order));
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
