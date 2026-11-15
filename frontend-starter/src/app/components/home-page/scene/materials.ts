import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';

/** Shared physically based materials. Roughness and metalness are in [0, 1]. */
export const chrome = () => new MeshStandardMaterial({ color: 0xd8d8de, metalness: 1, roughness: 0.12 });

export const ivory = () => new MeshPhysicalMaterial({ color: 0xf4efe4, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 });

export const matte = (color: number, roughness = 0.85) => new MeshStandardMaterial({ color, roughness, metalness: 0 });

/** Light-emitting surface; keep `intensity` low (≤ 1.5) to avoid glare with the bloom pass. */
export const glow = (color: number, intensity = 1) =>
  new MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 });
