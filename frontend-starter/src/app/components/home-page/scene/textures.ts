import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { fbm, seededRandom } from './noise';

/**
 * Procedural textures drawn on canvases at start-up: no image file is downloaded.
 * Every texture is created once and disposed with the scene.
 */

function canvas(size: number, height = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible');
  return [element, context];
}

function toTexture(element: HTMLCanvasElement, repeatX = 1, repeatY = repeatX, color = true): Texture {
  const texture = new CanvasTexture(element);
  if (color) texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 8;
  return texture;
}

/** Draws a wood grain inside a rectangle, with rings and pores along the X axis. */
function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: [number, number, number], seed: number): void {
  const random = seededRandom(seed);
  const tint = 0.82 + random() * 0.3;
  const image = ctx.getImageData(x, y, w, h);
  const offset = random() * 100;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const n = fbm((px + offset) / 90, (py + offset) / 9, 3, seed);
      const rings = Math.sin((py / h) * 18 + n * 9 + offset) * 0.5 + 0.5;
      const shade = tint * (0.78 + rings * 0.16 + (fbm(px / 6, py / 2, 2, seed + 3) - 0.5) * 0.12);
      const index = (py * w + px) * 4;
      image.data[index] = base[0] * shade;
      image.data[index + 1] = base[1] * shade;
      image.data[index + 2] = base[2] * shade;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, x, y);
}

/** Generic wood (planks, fence, guitar neck) with a colour tint. */
export function woodTexture(base: [number, number, number], seed: number, repeatX = 1, repeatY = 1): Texture {
  const [element, ctx] = canvas(512, 256);
  woodGrain(ctx, 0, 0, 512, 256, base, seed);
  return toTexture(element, repeatX, repeatY);
}

/** Woven fabric for acoustic panels and the chair (soft, slightly irregular weave). */
export function fabricTexture(base: [number, number, number]): Texture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.94 : 1.04;
      const shade = weave * (0.9 + fbm(x / 30, y / 30, 3, 17) * 0.16) * (0.96 + Math.random() * 0.06);
      const index = (y * size + x) * 4;
      image.data[index] = base[0] * shade;
      image.data[index + 1] = base[1] * shade;
      image.data[index + 2] = base[2] * shade;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(element, 3, 3);
}

/**
 * Music session shown on the computer screen: transport bar, tracks with
 * coloured clips and waveforms, playhead and mixer meters. Drawn once.
 */
export function dawScreenTexture(compactScreen: boolean): Texture {
  const width = 1600;
  const height = 680;
  const [element, ctx] = canvas(width, height);
  const random = seededRandom(23);
  ctx.fillStyle = '#121216';
  ctx.fillRect(0, 0, width, height);

  // Top bar: session name and transport.
  const barTextY = compactScreen ? 49 : 36;
  const transportCenter = compactScreen ? 1020 : width / 2;
  ctx.fillStyle = '#1b1b21';
  ctx.fillRect(0, 0, width, compactScreen ? 68 : 56);
  ctx.fillStyle = '#f5a623';
  ctx.font = `600 ${compactScreen ? 54 : 22}px "DM Sans", sans-serif`;
  ctx.fillText('ZAKAT RECORD', 28, barTextY);
  ctx.fillStyle = '#9a9aa4';
  ctx.font = '18px "JetBrains Mono", monospace';
  ctx.fillText('Session 001 — Minuit sur la ville', compactScreen ? 490 : 230, barTextY);
  ctx.fillStyle = '#e8e3d8';
  ctx.fillText('92 BPM   La mineur   01:24:310', width - 420, barTextY);
  for (const [x, symbol] of [[transportCenter - 60, '■'], [transportCenter - 20, '▶'], [transportCenter + 20, '●']] as const) {
    ctx.fillStyle = symbol === '●' ? '#e0574a' : '#e8e3d8';
    ctx.fillText(symbol, x, barTextY + 1);
  }

  // Track headers and lanes.
  const tracks = [['Drums', '#f5a623'], ['808', '#c78bff'], ['Keys', '#6fd3ff'], ['Synth lead', '#8ee08e'], ['Voix', '#ff8a7a'], ['Adlibs', '#e8d6a8']];
  const laneTop = 80;
  const laneHeight = 76;
  const headerWidth = 210;
  tracks.forEach(([name, color], index) => {
    const y = laneTop + index * laneHeight;
    ctx.fillStyle = index % 2 ? '#17171c' : '#141418';
    ctx.fillRect(0, y, width, laneHeight - 4);
    ctx.fillStyle = color;
    ctx.fillRect(0, y, 6, laneHeight - 4);
    ctx.fillStyle = '#dcd7cc';
    ctx.font = '18px "DM Sans", sans-serif';
    ctx.fillText(name, 22, y + 42);
    // Clips with a simple waveform or MIDI notes inside.
    let x = headerWidth + random() * 80;
    while (x < width - 120) {
      const clipWidth = 160 + random() * 260;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y + 8, clipWidth, laneHeight - 20, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#121216';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px < clipWidth - 8; px += 3) {
        const amplitude = (0.3 + random() * 0.7) * (laneHeight - 34) / 2;
        ctx.moveTo(x + 4 + px, y + laneHeight / 2 - 2 - amplitude);
        ctx.lineTo(x + 4 + px, y + laneHeight / 2 - 2 + amplitude);
      }
      ctx.stroke();
      x += clipWidth + 20 + random() * 120;
    }
  });

  // Bar grid and playhead.
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let x = headerWidth; x < width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, laneTop);
    ctx.lineTo(x, laneTop + tracks.length * laneHeight);
    ctx.stroke();
  }
  ctx.fillStyle = '#f5a623';
  ctx.fillRect(760, 60, 3, laneTop + tracks.length * laneHeight - 60);

  // Mixer meters along the bottom.
  const meterTop = laneTop + tracks.length * laneHeight + 14;
  ctx.fillStyle = '#18181d';
  ctx.fillRect(0, meterTop, width, height - meterTop);
  for (let i = 0; i < 24; i++) {
    const level = 0.25 + random() * 0.6;
    const meterHeight = (height - meterTop - 24) * level;
    const gradient = ctx.createLinearGradient(0, height - 12, 0, meterTop + 12);
    gradient.addColorStop(0, '#5fd38a');
    gradient.addColorStop(0.75, '#e8d36a');
    gradient.addColorStop(1, '#e0574a');
    ctx.fillStyle = gradient;
    ctx.fillRect(40 + i * 64, height - 12 - meterHeight, 18, meterHeight);
  }
  return toTexture(element, 1, 1);
}

/** Metal mesh used for the microphone grille (alpha: holes are transparent). */
export function grilleTexture(): Texture {
  const [element, ctx] = canvas(256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  return toTexture(element, 6, 3, false);
}
