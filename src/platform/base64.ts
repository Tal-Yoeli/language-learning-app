// Browser-only base64 helpers. Kept separate from the platform wrappers so the
// conversion logic can be unit tested without a DOM.
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';

  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
  }

  return btoa(binary);
}

export function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function base64ToBlob(base64: string, mimeType: string) {
  return new Blob([base64ToBytes(base64)], { type: mimeType });
}

export async function blobToBase64(blob: Blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
