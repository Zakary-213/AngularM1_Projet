import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Instruments float inside a corridor of this length (world units); they wrap around to make it endless. */
const CORRIDOR_LENGTH = 260;
const INSTRUMENT_COUNT = 70;
const DUST_COUNT = 900;
/** Idle forward speed in world units per second. */
const IDLE_SPEED = 2.4;
/** Distance travelled across the whole scroll range of the hero. */
const SCROLL_DISTANCE = 120;
const INTRO_SECONDS = 2.6;
/** Screen-space radius (normalised device coordinates) in which the cursor pushes instruments. */
const PUSH_RADIUS = 0.45;
const PUSH_STRENGTH = 2.2;
const MAX_PIXEL_RATIO = 1.75;

type InstrumentKind = 'vinyl' | 'microphone' | 'speaker' | 'drum' | 'headphones' | 'keyboard';
const INSTRUMENT_KINDS: readonly InstrumentKind[] = ['vinyl', 'microphone', 'speaker', 'drum', 'headphones', 'keyboard'];

interface FloatingInstrument {
  object: Group;
  glow: MeshStandardMaterial;
  home: Vector3;
  spin: Vector3;
  phase: number;
  push: Vector3;
}

export interface InstrumentSceneOptions {
  reducedMotion: boolean;
  onFirstFrame: () => void;
  onIntroDone: () => void;
}

/**
 * Procedural 3D scene of glowing studio instruments for the home hero.
 * Every model is built from three.js primitives: no external 3D asset is downloaded.
 * The class owns all WebGL resources and must be released with `dispose()`.
 */
export class InstrumentScene {
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(60, 1, 0.1, 400);
  private readonly cameraLight = new PointLight(0xffc27a, 60, 60, 1.6);
  private readonly instruments: FloatingInstrument[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly resizeObserver: ResizeObserver;

  private readonly pointer = new Vector2(0, 0);
  private readonly smoothPointer = new Vector2(0, 0);
  private pointerActive = false;
  private scrollProgress = 0;
  private smoothScroll = 0;
  private idleTravel = 0;
  /** 0 = normal flight, 1 = stopped and dispersed (call-to-action hovered). */
  private hoverTarget = 0;
  private hover = 0;
  private elapsed = 0;
  private lastTime = 0;
  private startTime = 0;
  private frameId = 0;
  private firstFrameSent = false;
  private introSent = false;

  private readonly projected = new Vector3();
  private readonly worldPosition = new Vector3();

  constructor(private readonly container: HTMLElement, private readonly options: InstrumentSceneOptions) {
    // Throws when WebGL is unavailable; the caller shows a fallback.
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x050505, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new FogExp2(0x050505, 0.028);
    this.scene.add(new HemisphereLight(0x8f86ff, 0x1a0f05, 1.1));
    this.camera.add(this.cameraLight);
    this.scene.add(this.camera);

    this.buildInstruments();
    this.buildDust();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.9, 0.55, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    container.addEventListener('pointermove', this.handlePointerMove);
    container.addEventListener('pointerleave', this.handlePointerLeave);

    if (options.reducedMotion) {
      this.elapsed = INTRO_SECONDS;
    }
    this.lastTime = this.startTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** Scroll progress through the hero, from 0 to 1. */
  setScrollProgress(progress: number): void {
    this.scrollProgress = Math.min(1, Math.max(0, progress));
  }

  /** Eases the flight to a stop and disperses the instruments. */
  startHoverTransition(): void {
    this.hoverTarget = 1;
  }

  stopHoverTransition(): void {
    this.hoverTarget = 0;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerleave', this.handlePointerLeave);
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const bounds = this.container.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.pointerActive = true;
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerActive = false;
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    // Narrow screens get a wider field of view so the corridor stays readable.
    this.camera.fov = width < 820 ? 75 : 60;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
  }

  private readonly tick = (now: number): void => {
    // Clamp the step so a tab coming back from the background does not jump.
    const delta = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += delta;
    this.update(delta);
    this.composer.render(delta);

    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.options.onFirstFrame();
    }
    // Wall-clock check: throttled frames (background tab, slow GPU) must not delay the interface.
    if (!this.introSent && (this.options.reducedMotion || now - this.startTime >= INTRO_SECONDS * 1000)) {
      this.introSent = true;
      this.options.onIntroDone();
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  private update(delta: number): void {
    const motion = this.options.reducedMotion ? 0 : 1;
    const ease = 1 - Math.exp(-delta * 3);
    this.hover += (this.hoverTarget - this.hover) * ease;
    this.smoothScroll += (this.scrollProgress - this.smoothScroll) * ease;
    this.smoothPointer.lerp(this.pointer, 1 - Math.exp(-delta * 5));

    this.idleTravel += IDLE_SPEED * delta * motion * (1 - this.hover);
    const intro = Math.min(1, this.elapsed / INTRO_SECONDS);
    const introOffset = (1 - easeOutCubic(intro)) * 40;
    const travel = this.idleTravel + this.smoothScroll * SCROLL_DISTANCE - introOffset;

    this.camera.position.set(this.smoothPointer.x * 1.2, this.smoothPointer.y * 0.7, -travel);
    this.camera.rotation.set(this.smoothPointer.y * 0.08, -this.smoothPointer.x * 0.12, 0);
    this.camera.updateMatrixWorld();
    this.bloom.strength = 0.9 + this.hover * 0.5;

    for (const instrument of this.instruments) {
      this.updateInstrument(instrument, delta, motion);
    }
  }

  private updateInstrument(instrument: FloatingInstrument, delta: number, motion: number): void {
    const { object, home, spin, phase } = instrument;
    // Wrap instruments that fall behind the camera back to the far end of the corridor.
    const cameraZ = this.camera.position.z;
    while (home.z > cameraZ + 8) home.z -= CORRIDOR_LENGTH;
    while (home.z < cameraZ - CORRIDOR_LENGTH + 8) home.z += CORRIDOR_LENGTH;

    const bob = Math.sin(this.elapsed * 0.8 + phase) * 0.35 * motion;
    // Hover disperses instruments radially away from the corridor axis.
    const radial = 1 + this.hover * 0.9;
    this.worldPosition.set(home.x * radial, home.y * radial + bob, home.z);

    // Screen-space push away from the cursor, strongest close to it.
    this.projected.copy(this.worldPosition).project(this.camera);
    let glow = 0;
    const targetPush = new Vector3();
    if (this.pointerActive && this.projected.z < 1) {
      const dx = this.projected.x - this.smoothPointer.x;
      const dy = this.projected.y - this.smoothPointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance < PUSH_RADIUS) {
        const force = (1 - distance / PUSH_RADIUS) ** 2;
        const length = distance || 1;
        targetPush.set((dx / length) * force * PUSH_STRENGTH, (dy / length) * force * PUSH_STRENGTH, 0);
        glow = force;
      }
    }
    instrument.push.lerp(targetPush, 1 - Math.exp(-delta * 6));
    object.position.copy(this.worldPosition).add(instrument.push);

    object.rotation.x += spin.x * delta * (motion + this.hover);
    object.rotation.y += spin.y * delta * (motion + this.hover);
    object.rotation.z += spin.z * delta * motion;
    instrument.glow.emissiveIntensity = 1.4 + glow * 3 + this.hover * 1.2;
  }

  private buildInstruments(): void {
    const palette = [0xffb347, 0xff6b3d, 0xc69bff, 0x6fd3ff, 0xf5efe2];
    const shared = {
      dark: this.track(new MeshStandardMaterial({ color: 0x15151a, metalness: 0.6, roughness: 0.35 })),
      chrome: this.track(new MeshStandardMaterial({ color: 0xb8b8c4, metalness: 1, roughness: 0.25 })),
      ivory: this.track(new MeshStandardMaterial({ color: 0xf2ece0, metalness: 0.1, roughness: 0.5 })),
    };
    const glows = palette.map(color => this.track(new MeshStandardMaterial({
      color: 0x111111, emissive: new Color(color), emissiveIntensity: 1.4, roughness: 0.4,
    })));

    for (let index = 0; index < INSTRUMENT_COUNT; index++) {
      const kind = INSTRUMENT_KINDS[index % INSTRUMENT_KINDS.length];
      const glow = glows[index % glows.length];
      const object = this.buildInstrument(kind, shared.dark, shared.chrome, shared.ivory, glow);
      // Deterministic pseudo-random layout keeps the scene identical between visits.
      const angle = seeded(index, 1) * Math.PI * 2;
      const radius = 4 + seeded(index, 2) * 9;
      const home = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, -(index / INSTRUMENT_COUNT) * CORRIDOR_LENGTH);
      object.scale.setScalar(0.8 + seeded(index, 3) * 0.7);
      object.rotation.set(seeded(index, 4) * 6, seeded(index, 5) * 6, seeded(index, 6) * 6);
      this.scene.add(object);
      this.instruments.push({
        object,
        glow,
        home,
        phase: seeded(index, 7) * Math.PI * 2,
        spin: new Vector3((seeded(index, 8) - 0.5) * 0.6, (seeded(index, 9) - 0.5) * 0.8, (seeded(index, 10) - 0.5) * 0.3),
        push: new Vector3(),
      });
    }
  }

  private buildInstrument(kind: InstrumentKind, dark: Material, chrome: Material, ivory: Material, glow: Material): Group {
    const group = new Group();
    const add = (geometry: BufferGeometry, material: Material, setup?: (mesh: Object3D) => void): void => {
      const mesh = new Mesh(this.track(geometry), material);
      setup?.(mesh);
      group.add(mesh);
    };

    switch (kind) {
      case 'vinyl':
        add(new CylinderGeometry(1.5, 1.5, 0.05, 48), dark, mesh => mesh.rotation.x = Math.PI / 2);
        add(new CylinderGeometry(0.5, 0.5, 0.07, 32), glow, mesh => mesh.rotation.x = Math.PI / 2);
        add(new TorusGeometry(1.15, 0.015, 6, 64), chrome);
        break;
      case 'microphone':
        add(new SphereGeometry(0.55, 24, 16), chrome, mesh => mesh.position.y = 1.1);
        add(new TorusGeometry(0.56, 0.05, 8, 32), glow, mesh => { mesh.position.y = 0.85; mesh.rotation.x = Math.PI / 2; });
        add(new CylinderGeometry(0.22, 0.32, 1.6, 20), dark, mesh => mesh.position.y = -0.05);
        break;
      case 'speaker':
        add(new BoxGeometry(1.6, 2.4, 1.2), dark);
        add(new TorusGeometry(0.5, 0.06, 8, 40), glow, mesh => { mesh.position.set(0, -0.45, 0.61); });
        add(new TorusGeometry(0.25, 0.04, 8, 32), glow, mesh => { mesh.position.set(0, 0.65, 0.61); });
        add(new SphereGeometry(0.3, 20, 12), chrome, mesh => { mesh.position.set(0, -0.45, 0.45); mesh.scale.z = 0.5; });
        break;
      case 'drum':
        add(new CylinderGeometry(1, 1, 0.9, 40, 1, true), glow);
        add(new CylinderGeometry(0.98, 0.98, 0.02, 40), ivory, mesh => mesh.position.y = 0.45);
        add(new TorusGeometry(1.02, 0.05, 8, 48), chrome, mesh => { mesh.position.y = 0.45; mesh.rotation.x = Math.PI / 2; });
        add(new TorusGeometry(1.02, 0.05, 8, 48), chrome, mesh => { mesh.position.y = -0.45; mesh.rotation.x = Math.PI / 2; });
        add(new CapsuleGeometry(0.04, 1.6, 4, 8), ivory, mesh => { mesh.position.set(0.3, 1.1, 0); mesh.rotation.z = 1.1; });
        break;
      case 'headphones':
        add(new TorusGeometry(1, 0.08, 10, 40, Math.PI), chrome);
        add(new CylinderGeometry(0.42, 0.42, 0.3, 28), dark, mesh => { mesh.position.set(-1, -0.1, 0); mesh.rotation.z = Math.PI / 2; });
        add(new CylinderGeometry(0.42, 0.42, 0.3, 28), dark, mesh => { mesh.position.set(1, -0.1, 0); mesh.rotation.z = Math.PI / 2; });
        add(new TorusGeometry(0.34, 0.05, 8, 28), glow, mesh => { mesh.position.set(-1.16, -0.1, 0); mesh.rotation.y = Math.PI / 2; });
        add(new TorusGeometry(0.34, 0.05, 8, 28), glow, mesh => { mesh.position.set(1.16, -0.1, 0); mesh.rotation.y = Math.PI / 2; });
        break;
      case 'keyboard': {
        add(new BoxGeometry(3, 0.25, 1), dark);
        const whiteKey = this.track(new BoxGeometry(0.19, 0.12, 0.7));
        const blackKey = this.track(new BoxGeometry(0.11, 0.14, 0.42));
        for (let key = 0; key < 14; key++) {
          const white = new Mesh(whiteKey, ivory);
          white.position.set(-1.3 + key * 0.2, 0.17, 0.1);
          group.add(white);
          if (key % 7 !== 2 && key % 7 !== 6 && key < 13) {
            const black = new Mesh(blackKey, glow);
            black.position.set(-1.2 + key * 0.2, 0.25, -0.05);
            group.add(black);
          }
        }
        break;
      }
    }
    return group;
  }

  /** Floating dust gives depth and a sense of speed. */
  private buildDust(): void {
    const positions = new Float32Array(DUST_COUNT * 3);
    for (let index = 0; index < DUST_COUNT; index++) {
      positions[index * 3] = (seeded(index, 11) - 0.5) * 40;
      positions[index * 3 + 1] = (seeded(index, 12) - 0.5) * 24;
      positions[index * 3 + 2] = -seeded(index, 13) * CORRIDOR_LENGTH * 2;
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = this.track(new PointsMaterial({
      color: 0xffd9a0, size: 0.08, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false,
    }));
    const dust = new Points(geometry, material);
    // The dust follows the camera in steps so it never runs out.
    dust.onBeforeRender = () => {
      dust.position.z = Math.floor(this.camera.position.z / CORRIDOR_LENGTH) * CORRIDOR_LENGTH + CORRIDOR_LENGTH / 2;
    };
    this.scene.add(dust);
  }

  private track<T extends BufferGeometry | Material>(resource: T): T {
    if (resource instanceof BufferGeometry) this.geometries.push(resource);
    else this.materials.push(resource);
    return resource;
  }
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

/** Deterministic value in [0, 1) derived from an index and a channel. */
function seeded(index: number, channel: number): number {
  const value = Math.sin(index * 127.1 + channel * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
