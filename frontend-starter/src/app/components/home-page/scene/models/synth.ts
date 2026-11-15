import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glow, ivory } from '../materials';

/** 49-key controller: 29 white keys. Sizes in metres. */
const WHITE_KEYS = 29;
const KEYBED_WIDTH = 0.66;

/**
 * Synthesizer / MIDI keyboard: aluminium-and-black body, keys, pitch and mod
 * wheels, a row of knobs, 2×4 velocity pads with a soft amber glow and a small
 * screen. Origin: under the centre of the body; keys towards +Z.
 */
export function createSynthesizer(): Group {
  const synth = new Group();
  const body = new MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.45, metalness: 0.3 });
  const panel = new MeshStandardMaterial({ color: 0x2c2c31, roughness: 0.35, metalness: 0.7 });
  const knobMaterial = new MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.5 });
  const mark = new MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.6 });

  const chassis = new Mesh(new RoundedBoxGeometry(0.92, 0.055, 0.32, 3, 0.012), body);
  chassis.position.y = 0.0275;
  synth.add(chassis);
  const topPanel = new Mesh(new RoundedBoxGeometry(0.9, 0.004, 0.12, 2, 0.002), panel);
  topPanel.position.set(0, 0.057, -0.09);
  synth.add(topPanel);

  // Keys.
  const keyWidth = KEYBED_WIDTH / WHITE_KEYS;
  const matrix = new Matrix4();
  const pattern = [true, true, false, true, true, true, false];
  const whites = new InstancedMesh(new BoxGeometry(keyWidth * 0.93, 0.018, 0.14), ivory(), WHITE_KEYS);
  const blackTotal = Array.from({ length: WHITE_KEYS - 1 }, (_, i) => pattern[i % 7]).filter(Boolean).length;
  const blacks = new InstancedMesh(new BoxGeometry(keyWidth * 0.55, 0.02, 0.085), new MeshStandardMaterial({ color: 0x070707, roughness: 0.3 }), blackTotal);
  let blackIndex = 0;
  const keysLeft = -0.45 + 0.2;
  for (let i = 0; i < WHITE_KEYS; i++) {
    const x = keysLeft + keyWidth * (i + 0.5);
    whites.setMatrixAt(i, matrix.makeTranslation(x, 0.062, 0.075));
    if (i < WHITE_KEYS - 1 && pattern[i % 7]) {
      blacks.setMatrixAt(blackIndex++, matrix.makeTranslation(x + keyWidth / 2, 0.075, 0.048));
    }
  }
  synth.add(whites, blacks);

  // Pitch and modulation wheels on the left.
  for (const x of [-0.39, -0.34]) {
    const wheel = new Mesh(new CylinderGeometry(0.022, 0.022, 0.016, 24), knobMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.06, 0.07);
    synth.add(wheel);
  }

  // Knobs row with a white indicator line.
  for (let i = 0; i < 8; i++) {
    const knob = new Mesh(new CylinderGeometry(0.011, 0.012, 0.018, 20), knobMaterial);
    knob.position.set(-0.05 + i * 0.045, 0.068, -0.12);
    synth.add(knob);
    const line = new Mesh(new BoxGeometry(0.002, 0.0015, 0.008), mark);
    line.position.set(knob.position.x, 0.078, -0.124);
    line.rotation.y = -0.8 + i * 0.25;
    synth.add(line);
  }

  // Velocity pads: some softly lit (low intensity on purpose, no glare).
  for (let i = 0; i < 8; i++) {
    const lit = [0, 3, 5].includes(i);
    const pad = new Mesh(new RoundedBoxGeometry(0.034, 0.008, 0.034, 2, 0.004), lit ? glow(0xf5a623, 0.9) : new MeshStandardMaterial({ color: 0x2a2a2f, roughness: 0.7 }));
    pad.position.set(-0.4 + (i % 4) * 0.04, 0.062, -0.135 + Math.floor(i / 4) * 0.04);
    synth.add(pad);
  }

  // Small display.
  const screen = new Mesh(new BoxGeometry(0.09, 0.002, 0.03), glow(0x9fd6ff, 0.6));
  screen.position.set(-0.17, 0.06, -0.11);
  synth.add(screen);

  synth.traverse((object) => {
    if (object instanceof Mesh || object instanceof InstancedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return synth;
}
