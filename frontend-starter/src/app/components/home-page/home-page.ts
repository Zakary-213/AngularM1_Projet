import { Component } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DEMO_PROJECTS } from '../../shared/models/demo-projects';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, NgOptimizedImage],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePageComponent {
  readonly projects = DEMO_PROJECTS;

  // Deterministic decorative waveform: no audio processing or render-time randomness.
  readonly waveform = Array.from({ length: 88 }, (_, index) => ({
    height: 12 + ((index * 37 + index * index * 13) % 70),
    duration: 1.2 + (index % 7) * 0.17,
    delay: -(index % 13) * 0.14,
  }));

  readonly workflows = [
    { number: '01', title: 'COMPOSEZ.', description: 'Une ligne de basse, un beat, une mélodie. Donnez une forme à ce que vous avez en tête.', link: '/studio', action: 'Créer une production' },
    { number: '02', title: 'ENREGISTREZ.', description: 'Posez votre voix sur une instrumentale. Trouvez le bon équilibre, façonnez votre signature.', link: '/studio', action: 'Découvrir le studio' },
    { number: '03', title: 'PARTAGEZ.', description: 'Construisez avec votre équipe. Et quand le morceau est prêt, faites-le entendre.', link: '/collaborations', action: 'Créer à plusieurs' },
  ];
}
