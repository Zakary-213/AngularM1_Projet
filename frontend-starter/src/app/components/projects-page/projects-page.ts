import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEMO_PROJECTS } from '../../shared/models/demo-projects';

@Component({
  selector: 'app-projects-page',
  imports: [RouterLink],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
})
export class ProjectsPageComponent {
  readonly projects = DEMO_PROJECTS;
}
