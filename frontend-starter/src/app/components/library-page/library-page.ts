import { Component } from '@angular/core';

@Component({
  selector: 'app-library-page',
  templateUrl: './library-page.html',
  styleUrl: './library-page.css',
})
export class LibraryPageComponent {
  readonly sounds = [{ name: 'Warm piano', type: 'Instrument · Piano', icon: '♬', detail: 'Mélodique' }, { name: '808 Deep', type: 'Instrument · Basse', icon: '≋', detail: 'Grave' }, { name: 'Dusty drums', type: 'Kit · Batterie', icon: '▦', detail: '12 sons' }, { name: 'Midnight texture', type: 'Sample · Ambiance', icon: '◈', detail: '8 mesures' }];
}
