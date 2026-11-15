import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { dawScreenTexture } from '../textures';

/** Screen brightness: kept moderate so the image reads without glare or bloom. */
const SCREEN_INTENSITY = 0.75;

/**
 * Wide computer screen showing a music session, on an aluminium stand, with a mouse. Origin: desk surface below the stand.
 */
export function createComputer(): Group {
  const computer = new Group();
  const aluminium = new MeshStandardMaterial({ color: 0xb9bbc2, metalness: 1, roughness: 0.32 });
  const black = new MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.4, metalness: 0.2 });

  // Stand: base plate and arm.
  const base = new Mesh(new RoundedBoxGeometry(0.26, 0.012, 0.2, 3, 0.005), aluminium);
  base.position.set(0, 0.006, -0.05);
  const arm = new Mesh(new RoundedBoxGeometry(0.06, 0.3, 0.02, 3, 0.008), aluminium);
  arm.position.set(0, 0.16, -0.1);
  arm.rotation.x = -0.08;
  computer.add(base, arm);

  // Display: thin black body with a session texture on its front.
  const display = new Group();
  display.position.set(0, 0.36, -0.08);
  display.rotation.x = -0.05;
  const shell = new Mesh(new RoundedBoxGeometry(1.0, 0.44, 0.028, 4, 0.01), black);
  display.add(shell);
  const texture = dawScreenTexture();
  const screen = new Mesh(
    new PlaneGeometry(0.97, 0.41),
    new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: SCREEN_INTENSITY, roughness: 0.25, metalness: 0 }),
  );
  screen.position.z = 0.0145;
  display.add(screen);
  computer.add(display);

  // Mouse to the right of the synthesizer.
  const mouse = new Mesh(new CylinderGeometry(0.028, 0.03, 0.014, 24), black);
  mouse.scale.z = 1.7;
  mouse.position.set(0.62, 0.007, 0.38);
  computer.add(mouse);

  computer.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return computer;
}
