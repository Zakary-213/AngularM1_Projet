import { Injectable, OnDestroy, signal } from '@angular/core';

/** A minor 9 chord (Hz) played softly as a synthesised pad: no audio file is downloaded. */
const PAD_FREQUENCIES_HZ = [110, 164.81, 220, 261.63, 329.63, 493.88];
const PAD_VOLUME = 0.12;
const FADE_SECONDS = 1.2;
const OPEN_CUTOFF_HZ = 1400;
const MUFFLED_CUTOFF_HZ = 320;

/**
 * Ambient pad for the home hero. The AudioContext is only created on the first
 * user toggle (browser autoplay rules) and is closed when the provider is destroyed.
 * Provide it at component level so its lifecycle follows the page.
 */
@Injectable()
export class AmbientSoundService implements OnDestroy {
  readonly playing = signal(false);

  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private readonly sources: OscillatorNode[] = [];

  async toggle(): Promise<void> {
    const context = this.ensureGraph();
    if (context.state === 'suspended') {
      await context.resume();
    }
    const playing = !this.playing();
    this.playing.set(playing);
    this.rampTo(this.output!.gain, playing ? PAD_VOLUME : 0);
  }

  /** Low-pass "muffle" used while the call-to-action is hovered. */
  setMuffled(muffled: boolean): void {
    if (this.filter) {
      this.rampTo(this.filter.frequency, muffled ? MUFFLED_CUTOFF_HZ : OPEN_CUTOFF_HZ);
    }
  }

  ngOnDestroy(): void {
    this.sources.forEach(source => source.stop());
    this.sources.length = 0;
    void this.context?.close();
    this.context = null;
  }

  private ensureGraph(): AudioContext {
    if (this.context) {
      return this.context;
    }
    const context = new AudioContext();
    const output = context.createGain();
    output.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = OPEN_CUTOFF_HZ;
    filter.connect(output).connect(context.destination);

    PAD_FREQUENCIES_HZ.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index % 2 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (index - 2.5) * 4;
      const voice = context.createGain();
      voice.gain.value = 1 / PAD_FREQUENCIES_HZ.length;
      // Slow tremolo (0.05–0.15 Hz) so the pad breathes.
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.05 + index * 0.02;
      const lfoDepth = context.createGain();
      lfoDepth.gain.value = 0.4 / PAD_FREQUENCIES_HZ.length;
      lfo.connect(lfoDepth).connect(voice.gain);
      oscillator.connect(voice).connect(filter);
      oscillator.start();
      lfo.start();
      this.sources.push(oscillator, lfo);
    });

    this.context = context;
    this.output = output;
    this.filter = filter;
    return context;
  }

  private rampTo(param: AudioParam, value: number): void {
    const now = this.context!.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + FADE_SECONDS);
  }
}
