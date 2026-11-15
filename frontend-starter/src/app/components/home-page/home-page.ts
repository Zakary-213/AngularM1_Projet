import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild, viewChildren } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEMO_PROJECTS } from '../../shared/models/demo-projects';
import { AmbientSoundService } from '../../shared/services/ambient-sound.service';
import type { CinematicScene } from './scene/cinematic-scene';

/**
 * Steps of the camera move through the studio. `from`/`to` are scroll progress
 * values (0 → 1) where the caption is fully visible; they follow the camera path.
 */
const JOURNEY_STEPS = [
  { id: 'studio', number: '01', title: 'Le studio', tag: 'Ton espace', text: 'Un lieu pensé pour créer, de jour comme de nuit.', from: 0.14, to: 0.36 },
  { id: 'synth', number: '02', title: 'Le synthé', tag: 'Compose', text: 'Trouve la mélodie, pose les accords, programme tes drums.', from: 0.5, to: 0.72 },
  { id: 'session', number: '03', title: 'La session', tag: 'Mixe & exporte', text: 'Arrange, mixe et fais sonner ton morceau.', from: 0.86, to: 1.01 },
] as const;

/** Duration (in progress units) of a caption fading in or out. */
const CAPTION_FADE = 0.06;

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  providers: [AmbientSoundService],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePageComponent {
  readonly sound = inject(AmbientSoundService);
  readonly loaded = signal(false);
  readonly uiVisible = signal(false);
  readonly sceneError = signal<string | null>(null);
  readonly activeStep = signal(-1);
  readonly steps = JOURNEY_STEPS;
  readonly projects = DEMO_PROJECTS;

  readonly workflows = [
    { number: '01', title: 'COMPOSEZ.', description: 'Une ligne de basse, un beat, une mélodie. Donnez une forme à ce que vous avez en tête.', link: '/studio', action: 'Créer une production' },
    { number: '02', title: 'ENREGISTREZ.', description: 'Posez votre voix sur une instrumentale. Trouvez le bon équilibre, façonnez votre signature.', link: '/studio', action: 'Découvrir le studio' },
    { number: '03', title: 'PARTAGEZ.', description: 'Construisez avec votre équipe. Et quand le morceau est prêt, faites-le entendre.', link: '/collaborations', action: 'Créer à plusieurs' },
  ];

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly canvasHost = viewChild.required<ElementRef<HTMLElement>>('canvasHost');
  private readonly fade = viewChild.required<ElementRef<HTMLElement>>('fade');
  private readonly intro = viewChild.required<ElementRef<HTMLElement>>('intro');
  private readonly progressBar = viewChild.required<ElementRef<HTMLElement>>('progressBar');
  private readonly captions = viewChildren<ElementRef<HTMLElement>>('caption');
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private scene: CinematicScene | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      window.removeEventListener('scroll', this.updateScroll);
      this.scene?.dispose();
      this.scene = null;
    });
    // Browser only, after the hero exists. three.js is loaded on demand so it stays out of the initial bundle.
    afterNextRender(() => void this.startScene());
  }

  setMuffled(active: boolean): void {
    this.sound.setMuffled(active);
  }

  toggleSound(): void {
    this.sound.toggle().catch((error: unknown) => {
      console.error('Son d’ambiance indisponible', error);
      this.sceneError.set('Le son d’ambiance n’a pas pu démarrer dans ce navigateur.');
    });
  }

  /** Scrolls to the middle of a step (keyboard and screen-reader friendly navigation). */
  goToStep(index: number): void {
    const stage = this.stage().nativeElement;
    const range = stage.offsetHeight - window.innerHeight;
    const step = this.steps[index];
    const top = stage.offsetTop + range * Math.min(1, (step.from + step.to) / 2);
    window.scrollTo({ top, behavior: this.reducedMotion ? 'auto' : 'smooth' });
  }

  private async startScene(): Promise<void> {
    try {
      const { CinematicScene } = await import('./scene/cinematic-scene');
      if (this.destroyed) return;
      this.scene = new CinematicScene(this.canvasHost().nativeElement, {
        reducedMotion: this.reducedMotion,
        onFirstFrame: () => this.loaded.set(true),
        onIntroDone: () => this.uiVisible.set(true),
        onFrame: (progress, fade) => this.renderOverlay(progress, fade),
      });
      window.addEventListener('scroll', this.updateScroll, { passive: true });
      this.updateScroll();
    } catch (error: unknown) {
      // WebGL unavailable or chunk failed: keep the page usable with the static background.
      console.error('Scène 3D indisponible', error);
      this.sceneError.set('L’animation 3D n’est pas disponible sur cet appareil.');
      this.loaded.set(true);
      this.uiVisible.set(true);
      this.fade().nativeElement.style.opacity = '0';
    }
  }

  /** Per-frame overlay update, written straight to the DOM to avoid a change detection per frame. */
  private renderOverlay(progress: number, fade: number): void {
    this.fade().nativeElement.style.opacity = fade.toFixed(3);

    const introOpacity = 1 - ramp(progress, 0.03, 0.1);
    const introElement = this.intro().nativeElement;
    introElement.style.opacity = introOpacity.toFixed(3);
    introElement.style.visibility = introOpacity < 0.01 ? 'hidden' : 'visible';

    let active = -1;
    this.captions().forEach((caption, index) => {
      const step = this.steps[index];
      const opacity = ramp(progress, step.from - CAPTION_FADE, step.from) * (1 - ramp(progress, step.to, step.to + CAPTION_FADE));
      if (opacity > 0.5) active = index;
      const element = caption.nativeElement;
      element.style.opacity = opacity.toFixed(3);
      element.style.transform = `translateY(${((1 - opacity) * 18).toFixed(1)}px)`;
      element.style.visibility = opacity < 0.01 ? 'hidden' : 'visible';
    });
    if (active !== this.activeStep()) this.activeStep.set(active);
    this.progressBar().nativeElement.style.transform = `scaleX(${progress.toFixed(4)})`;
  }

  private readonly updateScroll = (): void => {
    const bounds = this.stage().nativeElement.getBoundingClientRect();
    const range = bounds.height - window.innerHeight;
    this.scene?.setScrollProgress(range > 0 ? -bounds.top / range : 0);
  };
}
