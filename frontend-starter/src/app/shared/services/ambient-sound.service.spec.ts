import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmbientSoundService } from './ambient-sound.service';

/** Minimal Web Audio double: records gain ramps and lifecycle calls. */
class FakeParam {
  value = 0;
  ramps: number[] = [];
  cancelScheduledValues(): void {}
  setValueAtTime(): void {}
  linearRampToValueAtTime(value: number): void { this.ramps.push(value); }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  type = '';
  started = false;
  stopped = false;
  connect<T>(target: T): T { return target; }
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeNode[] = [];
  oscillators: FakeNode[] = [];
  closed = false;
  constructor() { FakeAudioContext.instances.push(this); }
  createGain(): FakeNode { const node = new FakeNode(); this.gains.push(node); return node; }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { const node = new FakeNode(); this.oscillators.push(node); return node; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; return Promise.resolve(); }
}

describe('AmbientSoundService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudioContext.instances = [];
  });

  it('does not create an AudioContext before the first user toggle', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const service = new AmbientSoundService();
    expect(service.playing()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('resumes the context, fades in, then fades out on the second toggle', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const service = new AmbientSoundService();

    await service.toggle();
    const context = FakeAudioContext.instances[0];
    const output = context.gains[0];
    expect(context.state).toBe('running');
    expect(service.playing()).toBe(true);
    expect(output.gain.ramps.at(-1)).toBeGreaterThan(0);

    await service.toggle();
    expect(service.playing()).toBe(false);
    expect(output.gain.ramps.at(-1)).toBe(0);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('stops every source and closes the context on destroy', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const service = new AmbientSoundService();
    await service.toggle();
    const context = FakeAudioContext.instances[0];

    service.ngOnDestroy();
    expect(context.oscillators.every(oscillator => oscillator.stopped)).toBe(true);
    expect(context.closed).toBe(true);
  });
});
