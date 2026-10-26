/**
 * Owned random streams.
 *
 * The game never reads the rot-js global singleton. Each run keeps one
 * `Rng` on `S.sim`, and every concern that rolls takes a `fork(label)`
 * child, so its draws can never shift another concern's. Level generation
 * derives a fresh stream from (seed, depth) instead of borrowing one.
 *
 * The rot-js map generators still read the global singleton internally,
 * so `using` bridges a stream in and out around exactly one synchronous
 * call; nothing else in the game touches that global.
 */
import * as ROT from "rot-js";

/** The private rot-js generator type this module wraps. */
type RotRng = ReturnType<typeof ROT.RNG.clone>;

/** A deterministic source of uniform numbers, independent of `ROT.RNG`. */
export interface Rng {
  /** Uniform float in [0, 1). */
  uniform(): number;
  /** Uniform integer in [lower, upper], inclusive. */
  int(lower: number, upper: number): number;
  /** An independent child stream, keyed by `label`. */
  fork(label: string): Rng;
  /** Run a rot-js routine that reads the global singleton on this stream. */
  using<T>(fn: () => T): T;
}

/** Keeps derived seeds in the same 31-bit range the game has always used. */
export const SEED_MODULUS = 2147483647;

/**
 * Mix a label into a seed (FNV-1a over the label's chars). Forks derive
 * from the parent's seed, not its current state, so drawing from the parent
 * never moves a child.
 */
function mixSeed(seed: number, label: string): number {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const mixed = ((seed ^ hash) >>> 1) % SEED_MODULUS;
  return mixed === 0 ? 1 : mixed;
}

/** One stream, wrapping a private rot-js generator so callers cannot share it. */
class OwnedRng implements Rng {
  /** Seed used to derive forks. */
  #seed: number;
  /** The wrapped rot-js generator. */
  #rng: RotRng;

  /** Seed a stream; the same seed always replays it. */
  constructor(seed: number) {
    // Alea treats 0 as infinity, so keep every stream on a real seed.
    this.#seed = seed === 0 ? 1 : seed;
    // clone() is the only way to get an independent instance from the
    // singleton; setSeed then overwrites all of its copied state.
    this.#rng = ROT.RNG.clone();
    this.#rng.setSeed(this.#seed);
  }

  /** Draw a uniform float in [0, 1). */
  uniform(): number {
    return this.#rng.getUniform();
  }

  /** Draw a uniform integer in [lower, upper]. */
  int(lower: number, upper: number): number {
    return this.#rng.getUniformInt(lower, upper);
  }

  /** Derive an independent stream from this stream's seed. */
  fork(label: string): Rng {
    return new OwnedRng(mixSeed(this.#seed, label));
  }

  /** Run a rot-js routine against this stream, then restore it. */
  using<T>(fn: () => T): T {
    ROT.RNG.setState(this.#rng.getState());
    try {
      return fn();
    } finally {
      this.#rng.setState(ROT.RNG.getState());
    }
  }
}

/** A fresh stream from a seed. */
export function createRng(seed: number): Rng {
  return new OwnedRng(seed);
}
