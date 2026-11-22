import { CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glow, matte } from './materials';
import { createComputer } from './models/computer';
import { createStudioMicrophone } from './models/microphone';
import { createStudioMonitor } from './models/speaker';
import { createSynthesizer } from './models/synth';
import { seededRandom } from './noise';
import { fabricTexture, woodTexture } from './textures';

/** Everything the engine needs to film the studio. Distances in metres. */
export interface StudioSet {
  group: Group;
  /** Camera and look-at paths, sampled with the journey progress (0 → 1). */
  cameraPath: CatmullRomCurve3;
  targetPath: CatmullRomCurve3;
  /** Vertical field of view (degrees) at the start and the end. */
  fov: [number, number];
  background: Color;
  fog: { color: Color; near: number; far: number };
  exposure: number;
  environmentIntensity: number;
  animate: (time: number) => void;
}

const DESK = { width: 2.4, depth: 0.8, height: 0.75, z: -1.3 };
const BACK_WALL_Z = -2.3;

const curve = (points: [number, number, number][]) =>
  new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal');

const shade = <T extends Mesh | InstancedMesh>(mesh: T, cast = true): T => {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
};

/**
 * Modern home studio at night: walnut desk with a wide screen, monitor
 * speakers, synthesizer, audio interface and headphones; wood slats, fabric
 * acoustic panels, gold records, a plant and warm, low-glare lighting.
 */
export function createStudioSet(shadowMapSize: number, compactScreen: boolean): StudioSet {
  const group = new Group();

  // Floor: dark oak planks and a rug.
  const floor = shade(new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ map: woodTexture([88, 60, 40], 81, 10, 10), roughness: 0.5 })), false);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  const rug = shade(new Mesh(new PlaneGeometry(2.8, 2.0), new MeshStandardMaterial({ map: fabricTexture([70, 64, 58]), roughness: 1 })), false);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.004, -0.6);
  group.add(rug);

  // Walls and ceiling in warm charcoal.
  const panelFabric = new MeshStandardMaterial({ map: fabricTexture([58, 66, 74]), roughness: 1 });
  const wall = matte(0x1d1a18, 0.92);
  const back = shade(new Mesh(new PlaneGeometry(8, 3.2), wall), false);
  back.position.set(0, 1.6, BACK_WALL_Z);
  group.add(back);
  for (const side of [-1, 1]) {
    const sideWall = shade(new Mesh(new PlaneGeometry(6, 3.2), wall), false);
    sideWall.position.set(side * 3, 1.6, 0.7);
    sideWall.rotation.y = -side * Math.PI / 2;
    group.add(sideWall);
    // Fabric acoustic panels (one shared material: the texture is generated once).
    for (let i = 0; i < 3; i++) {
      const panel = shade(new Mesh(new RoundedBoxGeometry(0.06, 1.1, 0.8, 3, 0.02), panelFabric));
      panel.position.set(side * 2.96, 1.55, -1.6 + i * 1.1);
      group.add(panel);
    }
  }
  const ceiling = new Mesh(new PlaneGeometry(8, 8), matte(0x121110));
  ceiling.position.y = 3.2;
  ceiling.rotation.x = Math.PI / 2;
  group.add(ceiling);

  // Vertical wood slats over dark felt behind the desk.
  const felt = shade(new Mesh(new PlaneGeometry(3.0, 2.6), matte(0x0d0c0c, 1)), false);
  felt.position.set(0, 1.5, BACK_WALL_Z + 0.01);
  group.add(felt);
  const slatCount = 40;
  const slats = shade(new InstancedMesh(new RoundedBoxGeometry(0.035, 2.6, 0.025, 2, 0.006), new MeshStandardMaterial({ map: woodTexture([150, 100, 62], 83, 0.2, 2), roughness: 0.55 }), slatCount));
  const matrix = new Matrix4();
  for (let i = 0; i < slatCount; i++) {
    slats.setMatrixAt(i, matrix.makeTranslation(-1.48 + i * 0.076, 1.5, BACK_WALL_Z + 0.03));
  }
  group.add(slats);

  // Gold records framed on each side of the slats.
  const gold = new MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.22 });
  for (const side of [-1, 1]) {
    const frame = shade(new Mesh(new RoundedBoxGeometry(0.5, 0.62, 0.04, 2, 0.008), matte(0x0b0b0b, 0.4)));
    frame.position.set(side * 2.15, 1.7, BACK_WALL_Z + 0.03);
    const disc = new Mesh(new CylinderGeometry(0.17, 0.17, 0.004, 64), gold);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(side * 2.15, 1.76, BACK_WALL_Z + 0.055);
    const label = new Mesh(new CylinderGeometry(0.05, 0.05, 0.005, 32), matte(0x7a2e1f, 0.6));
    label.rotation.x = Math.PI / 2;
    label.position.set(side * 2.15, 1.76, BACK_WALL_Z + 0.057);
    const plaque = new Mesh(new RoundedBoxGeometry(0.22, 0.05, 0.004, 1, 0.002), gold);
    plaque.position.set(side * 2.15, 1.48, BACK_WALL_Z + 0.055);
    group.add(frame, disc, label, plaque);
  }

  // Desk: walnut top on black steel legs.
  const walnut = new MeshStandardMaterial({ map: woodTexture([112, 72, 44], 85, 2, 1), roughness: 0.35 });
  const top = shade(new Mesh(new RoundedBoxGeometry(DESK.width, 0.05, DESK.depth, 3, 0.012), walnut));
  top.position.set(0, DESK.height - 0.025, DESK.z);
  group.add(top);
  const steel = new MeshStandardMaterial({ color: 0x141416, metalness: 0.7, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const leg = shade(new Mesh(new RoundedBoxGeometry(0.05, DESK.height - 0.05, DESK.depth - 0.1, 2, 0.01), steel));
    leg.position.set(side * (DESK.width / 2 - 0.15), (DESK.height - 0.05) / 2, DESK.z);
    group.add(leg);
  }
  // Soft warm LED strip under the back of the desk (indirect light only).
  const strip = new Mesh(new RoundedBoxGeometry(DESK.width - 0.3, 0.01, 0.01, 1, 0.004), glow(0xffb070, 0.8));
  strip.position.set(0, DESK.height - 0.06, DESK.z - DESK.depth / 2 + 0.03);
  group.add(strip);

  const deskTop = DESK.height;
  const computer = createComputer(compactScreen);
  computer.position.set(0, deskTop, DESK.z - 0.15);
  group.add(computer);

  const synth = createSynthesizer();
  synth.position.set(0, deskTop, DESK.z + 0.22);
  group.add(synth);

  const speakerWood = new MeshStandardMaterial({ map: woodTexture([96, 60, 36], 71), roughness: 0.4 });
  for (const side of [-1, 1]) {
    const speaker = createStudioMonitor(speakerWood);
    // Isolation pad then speaker, toed-in towards the listening position.
    const pad = shade(new Mesh(new RoundedBoxGeometry(0.22, 0.04, 0.26, 2, 0.01), matte(0x2a2a2e, 0.9)));
    pad.position.set(side * 0.8, deskTop + 0.02, DESK.z - 0.15);
    speaker.position.set(side * 0.8, deskTop + 0.04, DESK.z - 0.15);
    speaker.rotation.y = -side * 0.35;
    group.add(pad, speaker);
  }

  // Audio interface with a soft level meter.
  const interfaceBody = shade(new Mesh(new RoundedBoxGeometry(0.2, 0.05, 0.14, 2, 0.008), new MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.4, metalness: 0.4 })));
  interfaceBody.position.set(-0.68, deskTop + 0.025, DESK.z + 0.18);
  interfaceBody.rotation.y = 0.2;
  group.add(interfaceBody);
  const knobMaterial = matte(0x111111, 0.5);
  for (const x of [-0.05, 0.03]) {
    const knob = new Mesh(new CylinderGeometry(0.018, 0.02, 0.015, 24), knobMaterial);
    knob.position.set(x, 0.032, 0);
    interfaceBody.add(knob);
  }
  for (let i = 0; i < 5; i++) {
    const led = new Mesh(new SphereGeometry(0.003, 8, 6), glow(i < 4 ? 0x5fd38a : 0xe8d36a, 1));
    led.position.set(0.07, 0.026, -0.03 + i * 0.012);
    interfaceBody.add(led);
  }

  // Headphones resting on the desk.
  const headphones = new Group();
  const band = new Mesh(new TorusGeometry(0.09, 0.012, 10, 32, Math.PI), matte(0x101012, 0.5));
  headphones.add(band);
  for (const side of [-1, 1]) {
    const cup = new Mesh(new CylinderGeometry(0.045, 0.045, 0.03, 28), matte(0x1a1a1c, 0.45));
    cup.rotation.z = Math.PI / 2;
    cup.position.set(side * 0.09, -0.005, 0);
    headphones.add(cup);
  }
  headphones.rotation.set(-Math.PI / 2, 0, 0.5);
  headphones.position.set(0.95, deskTop + 0.03, DESK.z + 0.15);
  headphones.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
  group.add(headphones);

  // Desk lamp on the left: its bulb is the warm practical light.
  const lamp = new Group();
  const lampBase = new Mesh(new CylinderGeometry(0.07, 0.08, 0.02, 32), steel);
  const lampArm = new Mesh(new CylinderGeometry(0.008, 0.008, 0.5, 10), steel);
  lampArm.position.set(0.05, 0.25, 0);
  lampArm.rotation.z = -0.2;
  const lampHead = new Mesh(new CylinderGeometry(0.03, 0.07, 0.1, 24, 1, true), steel);
  lampHead.position.set(0.16, 0.49, 0.02);
  lampHead.rotation.z = -0.9;
  const bulb = new Mesh(new SphereGeometry(0.022, 16, 12), glow(0xffd29a, 1.0));
  bulb.position.set(0.18, 0.46, 0.02);
  lamp.add(lampBase, lampArm, lampHead, bulb);
  // Far left of the desk, head turned towards the centre so it never overlaps a speaker.
  lamp.position.set(-1.1, deskTop, DESK.z - 0.28);
  lamp.rotation.y = -0.5;
  lamp.traverse((o) => { if (o instanceof Mesh && o !== bulb) o.castShadow = true; });
  group.add(lamp);

  // Microphone on its stand, left of the desk.
  const microphone = createStudioMicrophone();
  microphone.position.set(-1.6, 0, -0.7);
  microphone.rotation.y = 0.9;
  group.add(microphone);

  // Plant in the corner for a lived-in feel.
  const pot = shade(new Mesh(new CylinderGeometry(0.2, 0.16, 0.42, 32), matte(0xd9cbb3, 0.7)));
  pot.position.set(2.35, 0.21, -1.8);
  group.add(pot);
  const leafMaterial = new MeshStandardMaterial({ color: 0x2f5a35, roughness: 0.6 });
  const random = seededRandom(91);
  for (let i = 0; i < 14; i++) {
    const leaf = new Mesh(new SphereGeometry(0.12, 12, 8), leafMaterial);
    leaf.scale.set(0.45, 1.4, 0.12);
    const angle = random() * Math.PI * 2;
    const height = 0.6 + random() * 0.9;
    leaf.position.set(2.35 + Math.cos(angle) * 0.18, height, -1.8 + Math.sin(angle) * 0.18);
    leaf.rotation.set((random() - 0.5) * 0.9, angle, (random() - 0.5) * 0.9);
    leaf.castShadow = true;
    group.add(leaf);
  }

  // Lighting: warm, soft and indirect. No coloured neon, no glare.
  const hemisphere = new HemisphereLight(0xffe8d0, 0x1a120c, 0.45);
  const key = new DirectionalLight(0xfff1e0, 1.3);
  key.position.set(1.5, 4, 2);
  key.target.position.set(0, 0.8, DESK.z);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
  key.shadow.camera.updateProjectionMatrix();
  const lampLight = new PointLight(0xffc48a, 2.6, 3.5, 2);
  lampLight.position.set(-0.95, deskTop + 0.42, DESK.z - 0.15);
  const biasLight = new PointLight(0xffa860, 1.4, 2.5, 2);
  biasLight.position.set(0, deskTop + 0.4, DESK.z - 0.45);
  group.add(hemisphere, key, key.target, lampLight, biasLight);

  const lampBase0 = lampLight.intensity;
  return {
    group,
    // Wide shot → approach → over the synthesizer → face the screen.
    cameraPath: curve([[0, 1.75, 4.2], [0.35, 1.5, 2.2], [0.15, 1.3, 0.5], [0.02, 1.13, -0.5], [0, 1.12, -0.62]]),
    targetPath: curve([[0, 1.0, -1.6], [0, 0.95, -1.5], [0, 0.85, -1.25], [0, 0.78, -1.08], [0, 1.13, -1.55]]),
    fov: [46, 40],
    background: new Color(0x0b0a09),
    fog: { color: new Color(0x0b0a09), near: 6, far: 14 },
    exposure: 1.0,
    environmentIntensity: 0.35,
    // A barely perceptible flicker gives the lamp some life.
    animate: (time) => {
      lampLight.intensity = lampBase0 * (1 + Math.sin(time * 1.3) * 0.015);
    },
  };
}
