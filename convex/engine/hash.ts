// Shared lightweight prompt hash.
//
// Boundary: pure/default-runtime-safe. This module intentionally has no
// Convex imports, node imports, fs, or fetch so both default-runtime
// mutations and node-runtime actions can use the same prompt identity.

/**
 * DJB2-style 32-bit hash -> 8-char hex string. Stable across calls, same
 * input always produces the same output. This is a cheap audit identity for
 * prompt text, not a cryptographic digest.
 */
export function hashHex(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
