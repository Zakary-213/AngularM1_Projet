import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { isClipHeld, meterFraction, nextClipTime } from '../../shared/audio/level-meter';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { StudioTrackInfo } from '../../shared/audio/studio-tracks';
import { EqBand, FLAT_THREE_BAND_EQ, MAX_BAND_DB, isFlatEq } from '../../shared/audio/three-band-eq';
import {
  FxSend,
  MAX_MASTER_DB,
  MAX_TRACK_DB,
  MIN_MASTER_DB,
  MIN_TRACK_DB,
  TrackId,
  VocalTrackId,
  isTrackAudible,
  isVocalTrackId,
  masterDbToVolume,
  masterVolumeToDb,
} from '../../shared/audio/track-mix';

/** Identifiant d'un vumètre : une piste ou le Master. */
type MeterId = TrackId | 'master';
type FxKind = 'reverb' | 'delay';

/**
 * Mixeur (M7) : volume, mute, solo, panoramique, égaliseur et envois d'effets de chaque
 * piste, volume Master et vumètres ; appliqués à l'écoute et à l'export.
 * Les vumètres sont dessinés hors d'Angular (requestAnimationFrame + style direct) :
 * seule l'alerte de saturation, qui change rarement, passe par un signal.
 */
@Component({
  selector: 'app-mixer-panel',
  templateUrl: './mixer-panel.html',
  styleUrl: './mixer-panel.css',
})
export class MixerPanelComponent {
  readonly session = inject(StudioSessionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tracks = this.session.studioTracks;
  readonly isVocalTrackId = isVocalTrackId;
  readonly minDb = MIN_TRACK_DB;
  readonly maxDb = MAX_TRACK_DB;
  readonly minMasterDb = MIN_MASTER_DB;
  readonly maxMasterDb = MAX_MASTER_DB;
  readonly maxBandDb = MAX_BAND_DB;
  readonly eqBands: readonly { band: EqBand; label: string; hint: string }[] = [
    { band: 'lowDb', label: 'Graves', hint: 'sous 200 Hz' },
    { band: 'midDb', label: 'Médiums', hint: 'autour de 1 kHz' },
    { band: 'highDb', label: 'Aigus', hint: 'au-dessus de 4 kHz' },
  ];
  readonly effects: readonly { kind: FxKind; label: string }[] = [
    { kind: 'reverb', label: 'Réverbération' },
    { kind: 'delay', label: 'Delay' },
  ];

  /** Vumètres en saturation (alerte maintenue CLIP_HOLD_MS après le dernier dépassement). */
  readonly clipping = signal<ReadonlySet<MeterId>>(new Set());
  readonly masterDb = computed(() => masterVolumeToDb(this.session.masterVolume()));

  /** Pistes rendues inaudibles par le solo d'une autre piste (affiché en texte, pas seulement en couleur). */
  readonly silencedBySolo = computed(() => {
    const mixer = this.session.mixer();
    return new Set(this.tracks().filter(track => !mixer[track.id].muted && !isTrackAudible(mixer, track.id)).map(track => track.id));
  });

  /** Une version corrigée de la prise active existe (onglet Correction vocale) : elle peut être activée ici. */
  correctionEnabled(id: VocalTrackId): boolean {
    const correction = this.session.correctionFor(id);
    return correction !== null && this.session.enabledCorrections()[correction.takeId] === true;
  }

  private readonly lastClipAt: Partial<Record<MeterId, number | null>> = {};
  private frame = 0;

  constructor() {
    afterNextRender(() => this.startMeters());
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  /** « Correction de hauteur » de la piste Voix : version corrigée ou prise originale, à l'écoute et à l'export. */
  toggleCorrection(id: VocalTrackId, event: Event): void {
    this.session.setUseCorrectedTake((event.target as HTMLInputElement).checked, id);
  }

  onVolume(track: StudioTrackInfo, event: Event): void {
    this.session.setTrack(track.id, { volumeDb: this.numberOf(event) });
  }

  /** Le curseur va de -100 (gauche) à 100 (droite) pour une saisie au clavier par pas de 5 %. */
  onPan(track: StudioTrackInfo, event: Event): void {
    this.session.setTrack(track.id, { pan: this.numberOf(event) / 100 });
  }

  onEq(track: StudioTrackInfo, band: EqBand, event: Event): void {
    this.session.setTrack(track.id, { eq: { ...this.session.mixer()[track.id].eq, [band]: this.numberOf(event) } });
  }

  resetEq(track: StudioTrackInfo): void {
    this.session.setTrack(track.id, { eq: FLAT_THREE_BAND_EQ });
  }

  isFlat(track: StudioTrackInfo): boolean {
    return isFlatEq(this.session.mixer()[track.id].eq);
  }

  toggleFx(track: StudioTrackInfo, kind: FxKind, event: Event): void {
    const send = this.session.mixer()[track.id][kind];
    this.session.setTrack(track.id, { [kind]: { ...send, enabled: (event.target as HTMLInputElement).checked } });
  }

  /** Quantité d'envoi en % (0 à 100). */
  onFxAmount(track: StudioTrackInfo, kind: FxKind, event: Event): void {
    const send = this.session.mixer()[track.id][kind];
    this.session.setTrack(track.id, { [kind]: { ...send, amount: this.numberOf(event) / 100 } });
  }

  onMaster(event: Event): void {
    this.session.setMasterVolume(masterDbToVolume(this.numberOf(event)));
  }

  formatDb(decibels: number): string {
    const sign = decibels > 0 ? '+' : '';
    return `${sign}${decibels.toFixed(0)} dB`;
  }

  formatMasterDb(decibels: number): string {
    return decibels <= MIN_MASTER_DB ? `${MIN_MASTER_DB} dB` : `${decibels.toFixed(1).replace('.', ',')} dB`;
  }

  formatPan(pan: number): string {
    const percent = Math.round(Math.abs(pan) * 100);
    return percent === 0 ? 'Centre' : `${percent} % ${pan < 0 ? 'à gauche' : 'à droite'}`;
  }

  shortPan(pan: number): string {
    const percent = Math.round(Math.abs(pan) * 100);
    return percent === 0 ? 'C' : `${pan < 0 ? 'G' : 'D'} ${percent}`;
  }

  percent(send: FxSend): number {
    return Math.round(send.amount * 100);
  }

  private numberOf(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  /**
   * Boucle d'affichage des vumètres. requestAnimationFrame est suspendu par le navigateur
   * quand l'onglet est masqué ; hors lecture, les barres sont vidées une fois puis laissées.
   */
  private startMeters(): void {
    const bars = new Map<MeterId, HTMLElement>();
    let lastTracks: ReturnType<typeof this.tracks> | null = null;
    let idle = false;
    const draw = () => {
      const tracks = this.tracks();
      if (lastTracks !== tracks) {
        lastTracks = tracks;
        bars.clear();
        this.host.nativeElement.querySelectorAll<HTMLElement>('[data-meter]').forEach(element => bars.set(element.dataset['meter'] as MeterId, element));
        idle = false;
      }
      const levels = this.session.readLevels();
      const now = performance.now();
      if (levels || !idle) {
        const peaks: Record<MeterId, number> = { ...(levels?.tracks ?? { drums: 0, melody: 0, bass: 0, instrumental: 0, voice: 0 }), master: levels?.master ?? 0 };
        const clipping = new Set<MeterId>();
        for (const [id, bar] of bars) {
          const peak = peaks[id] ?? 0;
          bar.style.transform = `scaleX(${meterFraction(peak)})`;
          this.lastClipAt[id] = nextClipTime(this.lastClipAt[id] ?? null, peak, now);
          if (isClipHeld(this.lastClipAt[id] ?? null, now)) {
            clipping.add(id);
          }
        }
        this.updateClipping(clipping);
        idle = levels === null && clipping.size === 0;
      }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  /** N'écrit le signal que si l'ensemble change : pas de rendu Angular à chaque image. */
  private updateClipping(next: Set<MeterId>): void {
    const current = this.clipping();
    if (current.size !== next.size || [...next].some(id => !current.has(id))) {
      this.clipping.set(next);
    }
  }
}
