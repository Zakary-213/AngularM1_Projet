import { PitchCorrectionSettings, PitchFrame, analyzePitch, correctPitch } from './pitch-correction';

/** Messages échangés avec le worker de correction. */
export interface PitchJobRequest {
  readonly id: number;
  readonly samples: Float32Array<ArrayBuffer>;
  readonly sampleRate: number;
  readonly settings: PitchCorrectionSettings;
}

export type PitchJobResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly output: Float32Array<ArrayBuffer>;
      readonly frames: PitchFrame[];
      readonly afterFrames: PitchFrame[];
      readonly processingMs: number;
    }
  | { readonly id: number; readonly ok: false; readonly message: string };

export type PitchJobResult = Extract<PitchJobResponse, { ok: true }>;

/** Erreur levée quand un calcul est remplacé ou annulé : ce n'est pas un échec à afficher. */
export class PitchJobCancelled extends Error {
  constructor() {
    super('Calcul annulé');
  }
}

/**
 * Lance la correction dans un Web Worker, un calcul à la fois. Un nouveau
 * calcul ou `cancel()` termine le worker en cours (le calcul est synchrone,
 * on ne peut pas l'interrompre autrement) ; sa promesse est rejetée avec
 * `PitchJobCancelled`. Sans support des workers, le calcul se fait sur place.
 */
export class PitchJobRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; reject: (reason: unknown) => void } | null = null;

  run(samples: Float32Array<ArrayBuffer>, sampleRate: number, settings: PitchCorrectionSettings): Promise<PitchJobResult> {
    this.cancel();
    if (typeof Worker === 'undefined') {
      return Promise.resolve(runInPlace(this.nextId++, samples, sampleRate, settings));
    }
    const id = this.nextId++;
    const worker = new Worker(new URL('./pitch-correction.worker', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<PitchJobResult>((resolve, reject) => {
      this.pending = { id, reject };
      worker.onmessage = ({ data }: MessageEvent<PitchJobResponse>) => {
        if (data.id !== id) {
          return;
        }
        this.release();
        if (data.ok) {
          resolve(data);
        } else {
          reject(new Error(data.message));
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        this.release();
        reject(new Error('Le calcul de correction a échoué dans le navigateur.'));
      };
      // Copie : l'original reste utilisable pour l'écoute « Avant ».
      const request: PitchJobRequest = { id, samples: samples.slice(), sampleRate, settings };
      worker.postMessage(request, [request.samples.buffer]);
    });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  cancel(): void {
    const pending = this.pending;
    this.release();
    pending?.reject(new PitchJobCancelled());
  }

  private release(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }
}

function runInPlace(id: number, samples: Float32Array, sampleRate: number, settings: PitchCorrectionSettings): PitchJobResult {
  const started = performance.now();
  const { output, frames } = correctPitch(samples, sampleRate, settings);
  const afterFrames = analyzePitch(output, sampleRate, { ...settings, strength: 0, transposeSemitones: 0 });
  return { id, ok: true, output, frames, afterFrames, processingMs: performance.now() - started };
}
