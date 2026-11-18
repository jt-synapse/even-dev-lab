// Pure 16-bit PCM -> RIFF/WAVE encoder and base64 codec (zero Node/DOM globals).

export const DEFAULT_G2_SAMPLE_RATE_HZ = 16000;
export const DEFAULT_CHANNELS = 1;
export const BITS_PER_SAMPLE = 16;
export const WAV_HEADER_BYTES = 44;

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    target[offset + i] = text.charCodeAt(i) & 0xff;
  }
}

/**
 * Estimate duration in seconds from raw 16-bit mono PCM byte count.
 */
export function estimatePcmDurationSeconds(
  pcmByteLength: number,
  sampleRateHz: number = DEFAULT_G2_SAMPLE_RATE_HZ,
  channels: number = DEFAULT_CHANNELS,
): number {
  const bytesPerSecond = sampleRateHz * channels * (BITS_PER_SAMPLE / 8);
  if (bytesPerSecond <= 0 || pcmByteLength <= 0) {
    return 0;
  }
  return pcmByteLength / bytesPerSecond;
}

/**
 * Concatenate signed 16-bit little-endian PCM chunks and prepend a 44-byte RIFF/WAVE header.
 */
export function encodePcm16LeToWav(
  chunks: readonly Uint8Array[],
  sampleRateHz: number = DEFAULT_G2_SAMPLE_RATE_HZ,
  channels: number = DEFAULT_CHANNELS,
): Uint8Array {
  const blockAlign = channels * (BITS_PER_SAMPLE / 8);
  const byteRate = sampleRateHz * blockAlign;

  let rawTotal = 0;
  for (const chunk of chunks) {
    rawTotal += chunk.byteLength;
  }
  // Ensure sample-aligned payload length (even byte count for 16-bit mono).
  const alignedDataBytes = rawTotal - (rawTotal % blockAlign);

  const wav = new Uint8Array(WAV_HEADER_BYTES + alignedDataBytes);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + alignedDataBytes, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, alignedDataBytes, true);

  let writeOffset = WAV_HEADER_BYTES;
  let remaining = alignedDataBytes;
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    const copyLen = Math.min(chunk.byteLength, remaining);
    if (copyLen > 0) {
      wav.set(chunk.subarray(0, copyLen), writeOffset);
      writeOffset += copyLen;
      remaining -= copyLen;
    }
  }

  return wav;
}

/**
 * Pure Uint8Array -> standard Base64 encoder (portable across WebView and Node).
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.byteLength;
  let i = 0;

  while (i + 2 < len) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out +=
      (BASE64_ALPHABET[(triplet >> 18) & 0x3f] ?? "") +
      (BASE64_ALPHABET[(triplet >> 12) & 0x3f] ?? "") +
      (BASE64_ALPHABET[(triplet >> 6) & 0x3f] ?? "") +
      (BASE64_ALPHABET[triplet & 0x3f] ?? "");
    i += 3;
  }

  const rem = len - i;
  if (rem === 1) {
    const b0 = bytes[i] ?? 0;
    const triplet = b0 << 16;
    out +=
      (BASE64_ALPHABET[(triplet >> 18) & 0x3f] ?? "") +
      (BASE64_ALPHABET[(triplet >> 12) & 0x3f] ?? "") +
      "==";
  } else if (rem === 2) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const triplet = (b0 << 16) | (b1 << 8);
    out +=
      (BASE64_ALPHABET[(triplet >> 18) & 0x3f] ?? "") +
      (BASE64_ALPHABET[(triplet >> 12) & 0x3f] ?? "") +
      (BASE64_ALPHABET[(triplet >> 6) & 0x3f] ?? "") +
      "=";
  }

  return out;
}
