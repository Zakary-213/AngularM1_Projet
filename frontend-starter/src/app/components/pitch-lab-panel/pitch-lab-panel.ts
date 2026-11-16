import { Component, OnDestroy, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AudioEngineService } from '../../shared/audio/audio-engine.service';
import { AUDIO_FILE_ACCEPT, validateAudioFile } from '../../shared/audio/audio-file';
import { NOTE_NAMES, SCALE_LABELS, ScaleName } from '../../shared/audio/pitch/musical-scale';
import {
  MAX_CORRECTION_SECONDS,
  PITCH_PRESETS,
  PitchCorrectionSettings,
  PitchPreset,
  analyzePitch,
  correctPitch,
  meanScaleDeviation,
} from '../../shared/audio/pitch/pitch-correction';
import { createTestVoice } from '../../shared/audio/pitch/test-voice';
import { encodeWav } from '../../shared/audio/wav-encoder';

interface VocalSource {
  readonly label: string;
  /** Mono : la correction travaille sur une seule voix. */
  readonly samples: Float32Array<ArrayBuffer>;
  readonly sampleRate: number;
}

interface CorrectionReport {
  readonly buffer: AudioBuffer;
  readonly beforeCents: number | null;
  readonly afterCents: number | null;
  readonly voicedPercent: number;
  readonly processingMs: number;
}

type Listening = 'original' | 'corrected' | null;

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
 * Prototype de correction de hauteur (#6) : la prise originale n'est jamais
 * modifiée ; la version corrigée est un nouveau buffer, comparable à l'oreille.
 */
@Component({
  selector: 'app-pitch-lab-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './pitch-lab-panel.html',
  styleUrl: './pitch-lab-panel.css',
})
export class PitchLabPanelComponent implements OnDestroy {
  private readonly engine = inject(AudioEngineService);
  private playingSource: AudioBufferSourceNode | null = null;

  /** Dernière prise du labo, proposée comme source. */
  readonly take = input<AudioBuffer | null>(null);

  readonly noteNames = NOTE_NAMES;
  readonly scaleLabels = SCALE_LABELS;
  readonly scales: readonly ScaleName[] = ['minor', 'major'];
  readonly maxSeconds = MAX_CORRECTION_SECONDS;
  readonly audioAccept = AUDIO_FILE_ACCEPT;

  readonly form = new FormGroup({
    root: new FormControl(9, { nonNullable: true }),
    scale: new FormControl<ScaleName>('minor', { nonNullable: true }),
    strengthPercent: new FormControl(PITCH_PRESETS.natural.strength * 100, { nonNullable: true }),
    retuneMs: new FormControl(PITCH_PRESETS.natural.retuneMs, { nonNullable: true }),
  });

  readonly source = signal<VocalSource | null>(null);
  readonly sourceError = signal<string | null>(null);
  readonly processing = signal(false);
  readonly report = signal<CorrectionReport | null>(null);
  readonly processError = signal<string | null>(null);
  readonly listening = signal<Listening>(null);

  ngOnDestroy(): void {
    this.stopListening();
  }

  applyPreset(preset: PitchPreset): void {
    const { strength, retuneMs } = PITCH_PRESETS[preset];
    this.form.patchValue({ strengthPercent: strength * 100, retuneMs });
  }

  useTake(): void {
    const take = this.take();
    if (take) {
      this.setSource({ label: 'Dernière prise du labo', samples: toMono(take), sampleRate: take.sampleRate });
    }
  }

  async useTestVoice(): Promise<void> {
    const { context } = await this.engine.start();
    this.setSource({ label: 'Voix de test synthétique (mélodie fausse en la mineur)', samples: createTestVoice(context.sampleRate), sampleRate: context.sampleRate });
    this.form.patchValue({ root: 9, scale: 'minor' });
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
      this.setSource({ label: file.name, samples: toMono(buffer), sampleRate: buffer.sampleRate });
    } catch (decodeError) {
      console.error('[pitch-lab] décodage impossible', decodeError);
      this.sourceError.set('Fichier illisible ou corrompu.');
    }
  }

  async correct(): Promise<void> {
    const source = this.source();
    if (!source || this.processing()) {
      return;
    }
    this.stopListening();
    this.processing.set(true);
    this.processError.set(null);
    // Laisse l'interface afficher « Calcul en cours » avant le calcul synchrone.
    await new Promise(resolve => setTimeout(resolve));
    try {
      const settings = this.settings();
      const started = performance.now();
      const { output, frames } = correctPitch(source.samples, source.sampleRate, settings);
      const processingMs = performance.now() - started;
      // Ré-analyse de la sortie, sans correction, pour mesurer l'écart restant.
      const afterFrames = analyzePitch(output, source.sampleRate, { ...settings, strength: 0 });
      const { context } = await this.engine.start();
      const buffer = context.createBuffer(1, output.length, source.sampleRate);
      buffer.copyToChannel(output, 0);
      this.report.set({
        buffer,
        beforeCents: meanScaleDeviation(frames, settings.root, settings.scale),
        afterCents: meanScaleDeviation(afterFrames, settings.root, settings.scale),
        voicedPercent: Math.round((100 * frames.filter(frame => frame.detectedHz !== null).length) / Math.max(1, frames.length)),
        processingMs: Math.round(processingMs),
      });
      console.log('[pitch-lab] correction appliquée', { processingMs: Math.round(processingMs), seconds: output.length / source.sampleRate });
    } catch (error) {
      console.error('[pitch-lab] correction impossible', error);
      this.processError.set(error instanceof RangeError ? error.message : 'La correction a échoué.');
    } finally {
      this.processing.set(false);
    }
  }

  async listen(which: Exclude<Listening, null>): Promise<void> {
    const wasPlaying = this.listening() === which;
    this.stopListening();
    if (wasPlaying) {
      return;
    }
    const source = this.source();
    const report = this.report();
    const { context, master } = await this.engine.start();
    let buffer: AudioBuffer | null = null;
    if (which === 'corrected') {
      buffer = report?.buffer ?? null;
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

  download(): void {
    const report = this.report();
    if (!report) {
      return;
    }
    const url = URL.createObjectURL(new Blob([encodeWav([report.buffer.getChannelData(0)], report.buffer.sampleRate)], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zakat-record-voix-corrigee.wav';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  formatCents(cents: number | null): string {
    return cents === null ? '—' : `${Math.round(cents)} cents`;
  }

  private settings(): PitchCorrectionSettings {
    const { root, scale, strengthPercent, retuneMs } = this.form.getRawValue();
    return { root: Number(root), scale, strength: Number(strengthPercent) / 100, retuneMs: Number(retuneMs) };
  }

  private setSource(source: VocalSource): void {
    this.stopListening();
    this.sourceError.set(null);
    this.report.set(null);
    if (source.samples.length > MAX_CORRECTION_SECONDS * source.sampleRate) {
      this.source.set(null);
      this.sourceError.set(`Extrait trop long : ${MAX_CORRECTION_SECONDS} s maximum pour ce prototype.`);
      return;
    }
    this.source.set(source);
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
