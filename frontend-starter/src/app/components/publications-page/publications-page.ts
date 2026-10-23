import { Component } from '@angular/core';
import { DEMO_PROJECTS } from '../../shared/models/demo-projects';

@Component({
  selector: 'app-publications-page',
  templateUrl: './publications-page.html',
  styleUrl: './publications-page.css',
})
export class PublicationsPageComponent {
  readonly projects = DEMO_PROJECTS;
}
