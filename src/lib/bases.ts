/**
 * bases.ts
 * Central definitions for nucleotide codes and conversion utilities.
 * This is a runtime module (not a declaration file).
 */

export type BaseCode = 0 | 1 | 2 | 3 | 4;

export const BASE: Record<string, BaseCode> = {
  A: 0,
  C: 1,
  G: 2,
  T: 3,
  N: 4,
};

export const BASE_CHAR: BaseCode[] = [0, 1, 2, 3, 4];
export const BASE_TO_ASCII: number[] = [65, 67, 71, 84, 78]; // A,C,G,T,N

export function isBaseCode(value: number): value is BaseCode {
  return value >= 0 && value <= 4;
}

export function baseToString(base: BaseCode): string {
  return ['A', 'C', 'G', 'T', 'N'][base];
}

export function stringToBase(str: string): BaseCode {
  return BASE[str.toUpperCase()] ?? 4;
}