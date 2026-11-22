import { ACESFilmicToneMapping, Fog, Material, Mesh, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { StudioSet, createStudioSet } from './studio-set';

/** Fade-in from black when the page opens, in seconds. */
const INTRO_SECONDS = 2;
/** The camera reaches the screen at this scroll progress, then holds the shot. */
const PATH_END = 0.9;
const MOBILE_BREAKPOINT = 820;
/** Portrait views widen the lens while keeping the same camera path and approach. */
const PORTRAIT_FRAMING_ASPECT = 0.85;
const PORTRAIT_CLOSE_UP_ASPECT = 0.98;
const MIN_PORTRAIT_ZOOM = 0.5;
/** Show both edges of the monitor as the session caption comes into view. */
const SESSION_FRAMING_ASPECT = 1.74;
const SESSION_REFRAME_START = 0.73;
const SESSION_REFRAME_END = 0.86;
/** Average frame time (seconds) above which the resolution is lowered to keep the page smooth. */
const SLOW_FRAME_SECONDS = 1 / 28;
const QUALITY_SAMPLE_FRAMES = 90;

export interface CinematicSceneOptions {
  reducedMotion: () => boolean;
  onFirstFrame: () => void;
  onIntroDone: () => void;
  /** Called every frame with the smoothed progress (0 → 1) and the black overlay opacity. */
  onFrame: (progress: number, fade: number) => void;
}

const smoothstep = (value: number) => value * value * (3 - 2 * value);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Scroll-driven camera move through the 3D studio: from a wide shot of the
 * room down to the desk, the synthesizer and finally the computer screen.
 * Owns every WebGL resource and must be released with `dispose()`.
 */
export class CinematicScene {
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(46, 1, 0.03, 60);
  private readonly set: StudioSet;
  private readonly environment: Texture;
  private readonly resizeObserver: ResizeObserver;

  private readonly pointer = new Vector2();
  private readonly smoothPointer = new Vector2();
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private scrollProgress = 0;
  private smoothProgress = 0;
  private startTime = 0;
  private lastTime = 0;
  private frameId = 0;
  private firstFrameSent = false;
  private introSent = false;
  private qualitySamples = 0;
  private qualityTotal = 0;
  private mobileViewport = false;

  constructor(private readonly container: HTMLElement, private readonly options: CinematicSceneOptions) {
    const mobile = container.clientWidth < MOBILE_BREAKPOINT;
    // Throws when WebGL is unavailable; the caller shows a static fallback.
    this.renderer = new WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Neutral environment for realistic reflections (generated, no HDR file).
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    this.set = createStudioSet(mobile ? 1024 : 1536, mobile);
    this.scene.add(this.set.group, this.camera);
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = this.set.environmentIntensity;
    this.scene.background = this.set.background;
    this.scene.fog = new Fog(this.set.fog.color, this.set.fog.near, this.set.fog.far);
    this.renderer.toneMappingExposure = this.set.exposure;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Very discreet bloom: only the lamp bulb and small LEDs glow a little.
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.22, 0.4, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.startTime = this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** Scroll progress through the hero, 0 → 1. */
  setScrollProgress(progress: number): void {
    this.scrollProgress = clamp01(progress);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('pointermove', this.handlePointerMove);
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
      }
    });
    for (const material of materials) {
      Object.values(material).forEach((value) => value instanceof Texture && textures.add(value));
      material.dispose();
    }
    textures.forEach((texture) => texture.dispose());
    this.environment.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  };

  /**
   * Measures the first frames once the intro is over; on a slow GPU, drops to a
   * pixel ratio of 1 and turns off the bloom instead of stuttering.
   */
  private adaptQuality(delta: number): void {
    if (this.qualitySamples < 0) return;
    if (performance.now() - this.startTime < INTRO_SECONDS * 1000) return;
    this.qualityTotal += delta;
    if (++this.qualitySamples < QUALITY_SAMPLE_FRAMES) return;
    if (this.qualityTotal / this.qualitySamples > SLOW_FRAME_SECONDS) {
      console.info('[CinematicScene] GPU lent : qualité réduite');
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.bloom.enabled = false;
      this.resize();
    }
    this.qualitySamples = -1;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.mobileViewport = width < MOBILE_BREAKPOINT;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
  }

  private readonly tick = (now: number): void => {
    // Clamp the step so a tab coming back from the background does not jump.
    const delta = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const time = (now - this.startTime) / 1000;
    const reducedMotion = this.options.reducedMotion();
    const motion = reducedMotion ? 0 : 1;

    this.smoothProgress = reducedMotion
      ? this.scrollProgress
      : this.smoothProgress + (this.scrollProgress - this.smoothProgress) * (1 - Math.exp(-delta * 4));
    this.smoothPointer.lerp(this.pointer, 1 - Math.exp(-delta * 3));

    // Camera along the paths, with a slow breathing and a light pointer parallax
    // that fades out in the close-ups.
    const along = smoothstep(clamp01(this.smoothProgress / PATH_END));
    this.set.cameraPath.getPoint(along, this.position);
    this.set.targetPath.getPoint(along, this.target);
    const parallax = (1 - along * 0.85) * motion;
    this.position.x += Math.sin(time * 0.3) * 0.03 * parallax + this.smoothPointer.x * 0.1 * parallax;
    this.position.y += Math.sin(time * 0.45) * 0.015 * parallax + this.smoothPointer.y * 0.05 * parallax;
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    this.camera.fov = this.set.fov[0] + (this.set.fov[1] - this.set.fov[0]) * along;
    const framingAspect = PORTRAIT_FRAMING_ASPECT + (PORTRAIT_CLOSE_UP_ASPECT - PORTRAIT_FRAMING_ASPECT) * along;
    const closeUpZoom = Math.min(1, Math.max(MIN_PORTRAIT_ZOOM, this.camera.aspect / framingAspect));
    this.camera.zoom = closeUpZoom;
    if (this.mobileViewport && this.camera.aspect < 1) {
      const reframe = clamp01((this.smoothProgress - SESSION_REFRAME_START) / (SESSION_REFRAME_END - SESSION_REFRAME_START));
      const monitorZoom = this.camera.aspect / SESSION_FRAMING_ASPECT;
      this.camera.zoom += (monitorZoom - closeUpZoom) * smoothstep(reframe);
    }
    this.camera.updateProjectionMatrix();
    this.set.animate(motion ? time : 0);

    const intro = reducedMotion ? 1 : clamp01(time / INTRO_SECONDS);
    const fade = 1 - smoothstep(intro);

    this.composer.render(delta);
    this.adaptQuality(delta);
    this.options.onFrame(this.smoothProgress, fade);

    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.options.onFirstFrame();
    }
    // Wall-clock check: throttled frames must not delay the interface.
    if (!this.introSent && (reducedMotion || time >= INTRO_SECONDS * 0.6)) {
      this.introSent = true;
      this.options.onIntroDone();
    }
    this.frameId = requestAnimationFrame(this.tick);
  };
}
