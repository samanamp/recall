// Spreading a whole Uint8Array into String.fromCharCode overflows the call
// stack (RangeError) once content passes ~100 KB; go 32 KB at a time.
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
