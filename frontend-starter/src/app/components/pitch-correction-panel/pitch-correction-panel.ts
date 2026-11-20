import { Component, DestroyRef, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AudioEngineService } from '../../shared/audio/audio-engine.service';
import { AUDIO_FILE_ACCEPT, validateAudioFile } from '../../shared/audio/audio-file';
import { NOTE_NAMES, SCALE_LABELS, SCALE_NAMES, ScaleName, scalePitchClasses } from '../../shared/audio/pitch/musical-scale';
import { MAX_CORRECTION_SECONDS, MAX_RETUNE_MS, MAX_TOLERANCE_CENTS, MAX_TRANSPOSE_SEMITONES, PitchFrame, meanDeviation } from '../../shared/audio/pitch/pitch-correction';
import { pitchCurvePaths } from '../../shared/audio/pitch/pitch-curve';
import { PitchJobCancelled, PitchJobRunner } from '../../shared/audio/pitch/pitch-job';
import { createTestVoice } from '../../shared/audio/pitch/test-voice';
import {
  DEFAULT_DOSE,
  DEFAULT_STYLE_ID,
  MAX_STYLE_NAME_LENGTH,
  MAX_USER_STYLES,
  UserVocalStyle,
  VOCAL_STYLES,
  VocalStyleId,
  VoiceSettings,
  findStyle,
  parseUserStyles,
  sameSettings,
  sanitizeVoiceSettings,
  styleSettings,
} from '../../shared/audio/pitch/vocal-styles';
import { MAX_EQ_DB, MAX_LOW_CUT_HZ } from '../../shared/audio/pitch/voice-eq';
import { FX_LIMITS, applyVoiceChain, tempoDelayMs } from '../../shared/audio/pitch/voice-fx';
import { StudioSessionService, downloadBlob } from '../../shared/audio/studio-session.service';
import { encodeWav } from '../../shared/audio/wav-encoder';

interface VocalSource {
  readonly label: string;
  /** Mono : la correction travaille sur une seule voix. */
  readonly samples: Float32Array<ArrayBuffer>;
  readonly sampleRate: number;
  /** La source est la prise du studio : la version corrigée peut remplacer la piste Voix. */
  readonly fromStudioTake: boolean;
}

interface CorrectionResult {
  readonly buffer: AudioBuffer;
  readonly frames: PitchFrame[];
  readonly beforeCents: number | null;
  readonly afterCents: number | null;
  readonly voicedPercent: number;
  readonly processingMs: number;
  readonly styleLabel: string;
}

type Listening = 'before' | 'after' | null;

/** Délai avant de recalculer après un changement de réglage (évite un calcul par cran de curseur). */
const RECOMPUTE_DELAY_MS = 250;
const USER_STYLES_STORAGE_KEY = 'zakat.vocalStyles.v1';
export const CURVE_WIDTH = 600;
export const CURVE_HEIGHT = 120;

function toMono(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    buffer.getChannelData(channel).forEach((sample, i) => (mono[i] += sample / buffer.numberOfChannels));
  }
  return mono;
}

/**
 * Correction vocale du studio (M9) : on choisit un style en un clic et on règle
 * une seule « dose d'effet » ; le panneau avancé expose tous les réglages et
 * bascule en « Personnalisé ». L'original n'est jamais modifié : chaque réglage
 * produit une nouvelle version, calculée dans un Web Worker et annulable.
 */
@Component({
  selector: 'app-pitch-correction-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './pitch-correction-panel.html',
  styleUrl: './pitch-correction-panel.css',
})
export class PitchCorrectionPanelComponent implements OnDestroy {
  private readonly engine = inject(AudioEngineService);
  readonly session = inject(StudioSessionService);
  private readonly runner = new PitchJobRunner();
  private playingSource: AudioBufferSourceNode | null = null;
  /** Incrémenté à chaque calcul : un résultat arrivé en retard n'écrase pas un plus récent. */
  private generation = 0;

  readonly styles = VOCAL_STYLES;
  readonly noteNames = NOTE_NAMES;
  readonly scaleNames = SCALE_NAMES;
  readonly scaleLabels = SCALE_LABELS;
  readonly maxSeconds = MAX_CORRECTION_SECONDS;
  readonly audioAccept = AUDIO_FILE_ACCEPT;
  readonly limits = { retune: MAX_RETUNE_MS, tolerance: MAX_TOLERANCE_CENTS, transpose: MAX_TRANSPOSE_SEMITONES, lowCut: MAX_LOW_CUT_HZ, eq: MAX_EQ_DB, ...FX_LIMITS };
  readonly curveWidth = CURVE_WIDTH;
  readonly curveHeight = CURVE_HEIGHT;

  readonly source = signal<VocalSource | null>(null);
  readonly sourceError = signal<string | null>(null);

  readonly styleId = signal<VocalStyleId>(DEFAULT_STYLE_ID);
  /** Nom du style personnel choisi, s'il y en a un. */
  readonly userStyleName = signal<string | null>(null);
  readonly dose = signal(DEFAULT_DOSE);
  /** Réglages modifiés à la main ; `null` tant qu'on suit le style choisi. */
  readonly custom = signal<VoiceSettings | null>(null);
  readonly userStyles = signal<UserVocalStyle[]>(this.loadUserStyles());

  readonly settings = computed<VoiceSettings>(
    () => this.custom() ?? styleSettings(findStyle(this.styleId()), this.dose(), this.session.projectKey(), this.session.bpm()),
  );
  readonly styleLabel = computed(() => {
    const base = this.userStyleName() ?? findStyle(this.styleId()).name;
    return this.custom() ? `Personnalisé (basé sur ${base})` : base;
  });

  readonly processing = signal(false);
  readonly result = signal<CorrectionResult | null>(null);
  readonly processError = signal<string | null>(null);
  readonly listening = signal<Listening>(null);
  readonly saveMessage = signal<string | null>(null);

  readonly curve = computed(() => {
    const result = this.result();
    return result ? pitchCurvePaths(result.frames, CURVE_WIDTH, CURVE_HEIGHT) : null;
  });
  readonly correctedOnTrack = computed(() => this.session.useCorrectedTake() && this.session.correctedTake() !== null);

  readonly advanced = new FormGroup({
    root: new FormControl(9, { nonNullable: true }),
    scale: new FormControl<ScaleName>('minor', { nonNullable: true }),
    notes: new FormArray(NOTE_NAMES.map(() => new FormControl(false, { nonNullable: true }))),
    strengthPercent: new FormControl(50, { nonNullable: true }),
    retuneMs: new FormControl(100, { nonNullable: true }),
    toleranceCents: new FormControl(0, { nonNullable: true }),
    transposeSemitones: new FormControl(0, { nonNullable: true }),
    lowCutHz: new FormControl(0, { nonNullable: true }),
    bodyDb: new FormControl(0, { nonNullable: true }),
    presenceDb: new FormControl(0, { nonNullable: true }),
    airDb: new FormControl(0, { nonNullable: true }),
    reverbPercent: new FormControl(0, { nonNullable: true }),
    reverbSeconds: new FormControl(1.5, { nonNullable: true }),
    delayPercent: new FormControl(0, { nonNullable: true }),
    delayMs: new FormControl(330, { nonNullable: true }),
    feedbackPercent: new FormControl(30, { nonNullable: true }),
  });
  readonly styleName = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MAX_STYLE_NAME_LENGTH)] });

  constructor() {
    // Le formulaire avancé reflète toujours les réglages effectifs (sans redéclencher ses abonnements).
    effect(() => this.patchAdvanced(this.settings()));
    this.advanced.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onAdvancedEdited());

    // Recalcul automatique : changer de style ou de dose suffit pour entendre la différence.
    effect(onCleanup => {
      const source = this.source();
      const settings = this.settings();
      const label = this.styleLabel();
      if (!source) {
        return;
      }
      const timer = setTimeout(() => untracked(() => void this.compute(source, settings, label)), RECOMPUTE_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // Propose d'emblée la prise du studio si elle existe.
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.runner.cancel());
    if (this.session.take()) {
      this.useStudioTake();
    }
  }

  ngOnDestroy(): void {
    this.stopListening();
  }

  selectStyle(id: VocalStyleId): void {
    this.userStyleName.set(null);
    this.styleId.set(id);
    this.custom.set(null);
  }

  selectUserStyle(style: UserVocalStyle): void {
    this.styleId.set(style.basedOn);
    this.userStyleName.set(style.name);
    // Un style personnel garde sa propre tonalité : il a été réglé pour elle.
    this.custom.set(style.settings);
  }

  onDose(event: Event): void {
    this.dose.set(Number((event.target as HTMLInputElement).value) / 100);
  }

  resetStyle(): void {
    this.custom.set(null);
    this.userStyleName.set(null);
    this.dose.set(DEFAULT_DOSE);
  }

  useStudioTake(): void {
    const take = this.session.take();
    if (take) {
      this.setSource({ label: 'Prise active du studio', samples: toMono(take.buffer), sampleRate: take.buffer.sampleRate, fromStudioTake: true });
    }
  }

  async useTestVoice(): Promise<void> {
    const { context } = await this.engine.start();
    this.setSource({ label: 'Voix de test (mélodie fausse en la mineur)', samples: createTestVoice(context.sampleRate), sampleRate: context.sampleRate, fromStudioTake: false });
  }

  async onFileSelected(event: Event): Promise<void> {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0];
    inputElement.value = '';
    if (!file) {
      return;
    }
    const error = validateAudioFile(file);
    if (error) {
      this.sourceError.set(error);
      return;
    }
    try {
      const buffer = await this.engine.decode(await file.arrayBuffer());
      this.setSource({ label: file.name, samples: toMono(buffer), sampleRate: buffer.sampleRate, fromStudioTake: false });
    } catch (decodeError) {
      console.error('[pitch-correction] décodage impossible', decodeError);
      this.sourceError.set('Fichier illisible ou corrompu.');
    }
  }

  cancel(): void {
    this.generation++;
    this.runner.cancel();
    this.processing.set(false);
  }

  retry(): void {
    const source = this.source();
    if (source) {
      void this.compute(source, this.settings(), this.styleLabel());
    }
  }

  async listen(which: Exclude<Listening, null>): Promise<void> {
    const wasPlaying = this.listening() === which;
    this.stopListening();
    if (wasPlaying) {
      return;
    }
    const source = this.source();
    const { context, master } = await this.engine.start();
    let buffer: AudioBuffer | null = null;
    if (which === 'after') {
      buffer = this.result()?.buffer ?? null;
    } else if (source) {
      buffer = context.createBuffer(1, source.samples.length, source.sampleRate);
      buffer.copyToChannel(source.samples, 0);
    }
    if (!buffer) {
      return;
    }
    const player = context.createBufferSource();
    player.buffer = buffer;
    player.connect(master);
    player.onended = () => {
      if (this.playingSource === player) {
        this.playingSource = null;
        this.listening.set(null);
      }
    };
    player.start();
    this.playingSource = player;
    this.listening.set(which);
  }

  /** Remplace la prise de la piste Voix par la version corrigée (l'originale reste conservée). */
  applyToVoiceTrack(): void {
    const result = this.result();
    if (result && this.source()?.fromStudioTake) {
      this.session.correctedTake.set({ buffer: result.buffer, styleLabel: result.styleLabel });
      this.session.useCorrectedTake.set(true);
    }
  }

  useOriginalOnTrack(): void {
    this.session.useCorrectedTake.set(false);
  }

  download(): void {
    const result = this.result();
    if (result) {
      downloadBlob(new Blob([encodeWav([result.buffer.getChannelData(0)], result.buffer.sampleRate)], { type: 'audio/wav' }), 'zakat-record-voix-corrigee.wav');
    }
  }

  saveUserStyle(): void {
    if (this.styleName.invalid) {
      this.styleName.markAsTouched();
      return;
    }
    const name = this.styleName.value.trim();
    const others = this.userStyles().filter(style => style.name !== name);
    if (others.length >= MAX_USER_STYLES) {
      this.saveMessage.set(`${MAX_USER_STYLES} styles personnels maximum : supprimez-en un.`);
      return;
    }
    const style: UserVocalStyle = { name, basedOn: this.styleId(), settings: this.settings() };
    this.persistUserStyles([...others, style], `Style « ${name} » enregistré dans ce navigateur.`);
    this.userStyleName.set(name);
    this.custom.set(style.settings);
    this.styleName.reset();
  }

  deleteUserStyle(style: UserVocalStyle): void {
    this.persistUserStyles(this.userStyles().filter(other => other.name !== style.name), `Style « ${style.name} » supprimé.`);
    if (this.userStyleName() === style.name) {
      this.userStyleName.set(null);
    }
  }

  /** Cale l'écho sur la croche du tempo du projet. */
  syncDelayToTempo(): void {
    this.advanced.controls.delayMs.setValue(tempoDelayMs(this.session.bpm(), 0.5));
  }

  baseName(id: VocalStyleId): string {
    return findStyle(id).name;
  }

  formatCents(cents: number | null): string {
    return cents === null ? '—' : `${Math.round(cents)} cents`;
  }

  formatSigned(value: number, unit: string): string {
    return `${value > 0 ? '+' : ''}${value} ${unit}`;
  }

  private async compute(source: VocalSource, settings: VoiceSettings, styleLabel: string): Promise<void> {
    const generation = ++this.generation;
    this.stopListening();
    this.processing.set(true);
    this.processError.set(null);
    try {
      const job = await this.runner.run(source.samples, source.sampleRate, settings);
      const equalized = await applyVoiceChain(job.output, source.sampleRate, settings.eq, settings.fx);
      if (generation !== this.generation) {
        return;
      }
      const { context } = await this.engine.start();
      const buffer = context.createBuffer(1, equalized.length, source.sampleRate);
      buffer.copyToChannel(equalized, 0);
      const allowed = settings.allowedPitchClasses;
      this.result.set({
        buffer,
        frames: job.frames,
        beforeCents: meanDeviation(job.frames, allowed),
        afterCents: meanDeviation(job.afterFrames, allowed),
        voicedPercent: Math.round((100 * job.frames.filter(frame => frame.detectedHz !== null).length) / Math.max(1, job.frames.length)),
        processingMs: Math.round(job.processingMs),
        styleLabel,
      });
      console.log('[pitch-correction] correction appliquée', { style: styleLabel, processingMs: Math.round(job.processingMs) });
    } catch (error) {
      if (error instanceof PitchJobCancelled || generation !== this.generation) {
        return;
      }
      console.error('[pitch-correction] correction impossible', error);
      this.processError.set(error instanceof Error ? error.message : 'La correction a échoué.');
    } finally {
      if (generation === this.generation) {
        this.processing.set(false);
      }
    }
  }

  private setSource(source: VocalSource): void {
    this.stopListening();
    this.sourceError.set(null);
    this.result.set(null);
    if (source.samples.length > MAX_CORRECTION_SECONDS * source.sampleRate) {
      this.source.set(null);
      this.sourceError.set(`Extrait trop long : ${MAX_CORRECTION_SECONDS} s maximum.`);
      return;
    }
    this.source.set(source);
  }

  private patchAdvanced(settings: VoiceSettings): void {
    this.advanced.setValue(
      {
        root: settings.root,
        scale: settings.scale,
        notes: NOTE_NAMES.map((_, pc) => settings.allowedPitchClasses.includes(pc)),
        strengthPercent: Math.round(settings.strength * 100),
        retuneMs: settings.retuneMs,
        toleranceCents: settings.toleranceCents,
        transposeSemitones: settings.transposeSemitones,
        lowCutHz: settings.eq.lowCutHz,
        bodyDb: settings.eq.bodyDb,
        presenceDb: settings.eq.presenceDb,
        airDb: settings.eq.airDb,
        reverbPercent: Math.round(settings.fx.reverbMix * 100),
        reverbSeconds: settings.fx.reverbSeconds,
        delayPercent: Math.round(settings.fx.delayMix * 100),
        delayMs: settings.fx.delayMs,
        feedbackPercent: Math.round(settings.fx.feedback * 100),
      },
      { emitEvent: false },
    );
  }

  /** Une modification du panneau avancé fait passer en « Personnalisé ». */
  private onAdvancedEdited(): void {
    const value = this.advanced.getRawValue();
    const previous = this.settings();
    const root = Number(value.root);
    // Changer de tonalité ou de gamme recoche les notes de la nouvelle gamme.
    const keyChanged = root !== previous.root || value.scale !== previous.scale;
    const allowed = keyChanged ? scalePitchClasses(root, value.scale) : value.notes.flatMap((on, pc) => (on ? [pc] : []));
    const next = sanitizeVoiceSettings({
      root,
      scale: value.scale,
      allowedPitchClasses: allowed,
      strength: Number(value.strengthPercent) / 100,
      retuneMs: Number(value.retuneMs),
      toleranceCents: Number(value.toleranceCents),
      transposeSemitones: Number(value.transposeSemitones),
      eq: { lowCutHz: Number(value.lowCutHz), bodyDb: Number(value.bodyDb), presenceDb: Number(value.presenceDb), airDb: Number(value.airDb) },
      fx: {
        reverbMix: Number(value.reverbPercent) / 100,
        reverbSeconds: Number(value.reverbSeconds),
        delayMix: Number(value.delayPercent) / 100,
        delayMs: Number(value.delayMs),
        feedback: Number(value.feedbackPercent) / 100,
      },
    });
    if (next && !sameSettings(next, previous)) {
      this.custom.set(next);
    }
  }

  private loadUserStyles(): UserVocalStyle[] {
    try {
      return parseUserStyles(localStorage.getItem(USER_STYLES_STORAGE_KEY));
    } catch (error) {
      // Stockage indisponible (navigation privée, données bloquées) : pas de styles personnels.
      console.warn('[pitch-correction] styles personnels illisibles', error);
      return [];
    }
  }

  private persistUserStyles(styles: UserVocalStyle[], successMessage: string): void {
    this.userStyles.set(styles);
    try {
      localStorage.setItem(USER_STYLES_STORAGE_KEY, JSON.stringify(styles));
      this.saveMessage.set(successMessage);
    } catch (error) {
      console.warn('[pitch-correction] enregistrement du style impossible', error);
      this.saveMessage.set("Le navigateur refuse l'enregistrement : le style est gardé jusqu'à la fermeture du studio.");
    }
  }

  private stopListening(): void {
    if (this.playingSource) {
      this.playingSource.onended = null;
      this.playingSource.stop();
      this.playingSource.disconnect();
      this.playingSource = null;
    }
    this.listening.set(null);
  }
}
