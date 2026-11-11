// Types for ./sim.js (shared by the game in the browser and the API routes).
export type Vec = { x: number; y: number };
export type Wind = { mph: number; dirDeg: number; dir: number; x: number; y: number };
export type Noise = { carry: number; lat: number };
export type SimResult = { surf: string; feet: number; pct: number; note: string; strike?: string; rest?: Vec };
export type SimOutput = {
  target: Vec;
  flight: { d: Vec; pr: Vec; carry: number; lat: number; apex: number; dur: number };
  landSurf: string;
  frames: Array<{ x: number; y: number; h: number }>;
  splash: boolean;
  result: SimResult;
};
export const SIM_VERSION: number;
export const TIERS: ReadonlyArray<{ ft: number; pct: number; color: string }>;
export const ON_GREEN_PCT: number;
export const HOLED_PCT: number;
export const PINS: ReadonlyArray<{ name: string; t: number; v: number }>;
export const WIND_MIN: number;
export const WIND_MAX: number;
export function mulberry32(seed: number): () => number;
export function shotNoise(rand: () => number): Noise;
export function windFrom(mph: number, dirDeg: number): Wind;
export function pinPos(i: number): Vec;
export function tierFor(feet: number): number;
export function surfaceAt(x: number, y: number): string;
export function clampTarget(x: number, y: number): Vec;
export function simulateShot(input: { pin: number; wind: Wind; target: Vec; e: number; noise?: Noise | null }): SimOutput;
