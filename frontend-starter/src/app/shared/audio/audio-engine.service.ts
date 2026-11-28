import { Injectable } from '@angular/core';
import { createMasterChain } from './mix-graph';

/**
 * Propriétaire unique de l'AudioContext du studio et de son Master.
 * Le contexte est créé au premier geste de l'utilisateur (règles d'autoplay)
 * puis réutilisé ; `suspend()` le met en pause quand aucune page audio n'est ouverte.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  /** À appeler depuis un gestionnaire de clic ou de touche. */
  async start(): Promise<{ context: AudioContext; master: GainNode }> {
    if (!this.context || !this.master) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = createMasterChain(this.context);
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return { context: this.context, master: this.master };
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    // Le chargement d'un projet doit décoder ses fichiers même avant le premier clic.
    const context = this.context ?? new OfflineAudioContext(1, 1, 44_100);
    return context.decodeAudioData(data);
  }

  /** Horloge musicale commune, en secondes (0 avant le démarrage du contexte). */
  currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** Latence de sortie estimée par le navigateur, en secondes (0 si inconnue). */
  outputLatencySeconds(): number {
    if (!this.context) {
      return 0;
    }
    return (this.context.baseLatency ?? 0) + (this.context.outputLatency ?? 0);
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') {
      await this.context.suspend();
    }
  }
}
