import { CapsuleGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, TorusGeometry } from 'three';
import { chrome } from '../materials';
import { grilleTexture } from '../textures';

/**
 * Large-diaphragm condenser microphone in a shock mount, on a boom stand,
 * with a pop filter. Origin: floor under the stand; capsule faces +Z.
 */
export function createStudioMicrophone(): Group {
  const rig = new Group();
  const metal = chrome();
  const black = new MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.6, roughness: 0.35 });
  const capsuleHeight = 1.52;

  // Tripod base and vertical stand.
  for (let i = 0; i < 3; i++) {
    const leg = new Mesh(new CylinderGeometry(0.008, 0.008, 0.38, 8), black);
    const angle = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(angle) * 0.16, 0.08, Math.sin(angle) * 0.16);
    leg.rotation.set(Math.sin(angle) * 1.1, 0, -Math.cos(angle) * 1.1);
    rig.add(leg);
  }
  const pole = new Mesh(new CylinderGeometry(0.011, 0.011, capsuleHeight - 0.1, 12), black);
  pole.position.y = (capsuleHeight - 0.1) / 2 + 0.1;
  rig.add(pole);

  const mic = new Group();
  mic.position.set(0, capsuleHeight, 0.18);
  rig.add(mic);
  const boom = new Mesh(new CylinderGeometry(0.008, 0.008, 0.2, 10), black);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, capsuleHeight - 0.12, 0.09);
  rig.add(boom);

  // Body: satin black lower part, chrome ring, mesh grille on top.
  const body = new Mesh(new CylinderGeometry(0.031, 0.026, 0.13, 32), black);
  body.position.y = -0.065;
  mic.add(body);
  const ring = new Mesh(new CylinderGeometry(0.033, 0.033, 0.012, 32), metal);
  ring.position.y = 0.005;
  mic.add(ring);
  const grilleMaterial = new MeshStandardMaterial({ color: 0xc8c8cc, metalness: 1, roughness: 0.25, alphaMap: grilleTexture(), transparent: true, side: DoubleSide, alphaTest: 0.4 });
  const grille = new Mesh(new CapsuleGeometry(0.032, 0.06, 8, 32), grilleMaterial);
  grille.position.y = 0.06;
  mic.add(grille);
  const capsule = new Mesh(new CylinderGeometry(0.022, 0.022, 0.004, 32), new MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }));
  capsule.rotation.x = Math.PI / 2;
  capsule.position.y = 0.06;
  mic.add(capsule);

  // Shock mount rings.
  for (const y of [-0.1, 0.02]) {
    const mount = new Mesh(new TorusGeometry(0.052, 0.004, 8, 40), black);
    mount.rotation.x = Math.PI / 2;
    mount.position.y = y;
    mic.add(mount);
  }

  // Pop filter on a gooseneck, between the singer and the capsule.
  const pop = new Group();
  pop.position.set(0, 0.06, 0.16);
  const hoop = new Mesh(new TorusGeometry(0.075, 0.005, 8, 48), black);
  pop.add(hoop);
  const screen = new Mesh(new CircleGeometry(0.073, 48), new MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.45, roughness: 1, side: DoubleSide }));
  pop.add(screen);
  mic.add(pop);

  rig.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  return rig;
}
