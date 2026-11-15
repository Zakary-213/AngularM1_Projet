import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEMO_PROJECTS } from '../../shared/models/demo-projects';
import { AmbientSoundService } from '../../shared/services/ambient-sound.service';
import type { InstrumentScene } from './instrument-scene';

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
  readonly projects = DEMO_PROJECTS;

  readonly workflows = [
    { number: '01', title: 'COMPOSEZ.', description: 'Une ligne de basse, un beat, une mélodie. Donnez une forme à ce que vous avez en tête.', link: '/studio', action: 'Créer une production' },
    { number: '02', title: 'ENREGISTREZ.', description: 'Posez votre voix sur une instrumentale. Trouvez le bon équilibre, façonnez votre signature.', link: '/studio', action: 'Découvrir le studio' },
    { number: '03', title: 'PARTAGEZ.', description: 'Construisez avec votre équipe. Et quand le morceau est prêt, faites-le entendre.', link: '/collaborations', action: 'Créer à plusieurs' },
  ];

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly canvasHost = viewChild.required<ElementRef<HTMLElement>>('canvasHost');
  private scene: InstrumentScene | null = null;
  private destroyed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      window.removeEventListener('scroll', this.updateScroll);
      this.scene?.dispose();
      this.scene = null;
    });
    // Browser only, after the hero exists. three.js is loaded on demand so it stays out of the initial bundle.
    afterNextRender(() => void this.startScene());
  }

  setHover(active: boolean): void {
    if (active) this.scene?.startHoverTransition();
    else this.scene?.stopHoverTransition();
    this.sound.setMuffled(active);
  }

  toggleSound(): void {
    this.sound.toggle().catch((error: unknown) => {
      console.error('Son d’ambiance indisponible', error);
      this.sceneError.set('Le son d’ambiance n’a pas pu démarrer dans ce navigateur.');
    });
  }

  private async startScene(): Promise<void> {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const { InstrumentScene } = await import('./instrument-scene');
      if (this.destroyed) return;
      this.scene = new InstrumentScene(this.canvasHost().nativeElement, {
        reducedMotion,
        onFirstFrame: () => this.loaded.set(true),
        onIntroDone: () => this.uiVisible.set(true),
      });
      window.addEventListener('scroll', this.updateScroll, { passive: true });
      this.updateScroll();
    } catch (error: unknown) {
      // WebGL unavailable or chunk failed: keep the page usable with the static background.
      console.error('Scène 3D indisponible', error);
      this.sceneError.set('L’animation 3D n’est pas disponible sur cet appareil.');
      this.loaded.set(true);
      this.uiVisible.set(true);
    }
  }

  private readonly updateScroll = (): void => {
    const bounds = this.stage().nativeElement.getBoundingClientRect();
    const range = bounds.height - window.innerHeight;
    this.scene?.setScrollProgress(range > 0 ? -bounds.top / range : 0);
  };
}
