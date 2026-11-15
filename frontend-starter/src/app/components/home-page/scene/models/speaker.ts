import { CircleGeometry, Group, Material, Mesh, MeshStandardMaterial, RingGeometry, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { woodTexture } from '../textures';

/**
 * Studio monitor speaker: walnut cabinet with a black front baffle, woofer cone
 * with a rubber surround, tweeter and a tiny power LED. Origin: centre of the
 * bottom face; drivers towards +Z. Sizes in metres. Pass a shared cabinet
 * material to avoid generating the wood texture twice.
 */
export function createStudioMonitor(cabinetMaterial: Material = new MeshStandardMaterial({ map: woodTexture([96, 60, 36], 71), roughness: 0.4 })): Group {
  const monitor = new Group();
  const cabinet = new Mesh(new RoundedBoxGeometry(0.2, 0.32, 0.25, 4, 0.02), cabinetMaterial);
  cabinet.position.y = 0.16;
  monitor.add(cabinet);
  const baffle = new Mesh(new RoundedBoxGeometry(0.196, 0.316, 0.01, 3, 0.008), new MeshStandardMaterial({ color: 0x111113, roughness: 0.55 }));
  baffle.position.set(0, 0.16, 0.122);
  monitor.add(baffle);
  const front = 0.128;

  const cone = new Mesh(new CircleGeometry(0.066, 48), new MeshStandardMaterial({ color: 0x1d1d21, roughness: 0.75 }));
  cone.position.set(0, 0.11, front);
  const surround = new Mesh(new TorusGeometry(0.068, 0.006, 10, 48), new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 }));
  surround.position.set(0, 0.11, front);
  const dust = new Mesh(new CircleGeometry(0.022, 32), new MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.4, roughness: 0.4 }));
  dust.position.set(0, 0.11, front + 0.002);
  const tweeter = new Mesh(new CircleGeometry(0.02, 32), new MeshStandardMaterial({ color: 0x5a5a62, metalness: 0.9, roughness: 0.25 }));
  tweeter.position.set(0, 0.24, front);
  const tweeterRing = new Mesh(new RingGeometry(0.021, 0.034, 40), new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6 }));
  tweeterRing.position.set(0, 0.24, front + 0.001);
  const led = new Mesh(new CircleGeometry(0.003, 12), new MeshStandardMaterial({ color: 0x000000, emissive: 0xf5f0e6, emissiveIntensity: 1.2 }));
  led.position.set(0.075, 0.03, front + 0.001);
  monitor.add(cone, surround, dust, tweeter, tweeterRing, led);

  monitor.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return monitor;
}
