import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, signal, viewChild } from '@angular/core';
import { computePeaks } from '../../shared/audio/waveform';

/**
 * Forme d'onde d'un fichier audio, dessinée sur un canvas. Elle n'est recalculée
 * que lorsque le fichier, la portion affichée ou la largeur changent : jamais
 * pendant la lecture. Décorative (aria-hidden) : le nom et la durée sont donnés en texte.
 */
@Component({
  selector: 'app-waveform',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: ':host { display: block; width: 100%; height: 100%; min-height: 24px; } canvas { display: block; width: 100%; height: 100%; }',
})
export class WaveformComponent implements OnDestroy {
  readonly buffer = input.required<AudioBuffer>();
  /** Bornes de la portion affichée, en secondes depuis le début du fichier. */
  readonly fromSeconds = input(0);
  readonly toSeconds = input<number | null>(null);
  readonly color = input('#bda4fa');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = signal({ width: 0, height: 0 });
  private observer: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      const element = this.canvas().nativeElement;
      this.observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        this.size.set({ width: Math.round(width), height: Math.round(height) });
      });
      this.observer.observe(element);
    });
    effect(() => this.draw(this.buffer(), this.fromSeconds(), this.toSeconds(), this.color(), this.size()));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private draw(buffer: AudioBuffer, fromSeconds: number, toSeconds: number | null, color: string, size: { width: number; height: number }): void {
    const canvas = this.canvas().nativeElement;
    const context = canvas.getContext('2d');
    if (!context || size.width === 0 || size.height === 0) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const end = Math.min(buffer.length, Math.round((toSeconds ?? buffer.duration) * buffer.sampleRate));
    const start = Math.max(0, Math.min(end, Math.round(fromSeconds * buffer.sampleRate)));
    // subarray : vue sur les échantillons existants, sans copie du buffer.
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).subarray(start, end));
    const { min, max } = computePeaks(channels, size.width);
    const middle = size.height / 2;
    context.fillStyle = color;
    for (let x = 0; x < size.width; x++) {
      const top = middle - max[x] * middle;
      const height = Math.max(1, (max[x] - min[x]) * middle);
      context.fillRect(x, top, 1, height);
    }
  }
}
