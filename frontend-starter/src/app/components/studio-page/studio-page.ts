import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-studio-page',
  imports: [RouterLink],
  templateUrl: './studio-page.html',
  styleUrl: './studio-page.css',
})
export class StudioPageComponent {
  readonly editorTabs = ['Piano roll', 'Mixeur', 'Effets'];
  readonly activeTab = signal('Piano roll');
  readonly instruments = [{ name: 'Drum machine', type: 'Rythme & percussions', icon: '▦' }, { name: '808 Bass', type: 'Basse & sub', icon: '≋' }, { name: 'Soft keys', type: 'Piano & claviers', icon: '♬' }, { name: 'Microphone', type: 'Voix & prises', icon: '♩' }];
  readonly tracks = [
    { name: 'Drums', type: 'Batterie', color: '#c1ed75', className: 'clip-lime', clip: 'Dusty drums · Pattern 01', offset: 0, width: 94 },
    { name: '808 Bass', type: 'Instrument', color: '#bda4fa', className: 'clip-purple', clip: '808 · Mélodie', offset: 0, width: 70 },
    { name: 'Soft keys', type: 'Instrument', color: '#eeb28c', className: 'clip-peach', clip: 'Piano · Accords', offset: 24, width: 70 },
    { name: 'Voix principale', type: 'Audio', color: '#8bc8dd', className: 'clip-blue', clip: 'Prise voix · 01', offset: 24, width: 46 },
  ];
}
