// Minimal pure-Node PNG decoder and RGBA framebuffer inspector for simulator screenshots.
// Uses node:zlib only (no external image dependency) and preserves the alpha channel.
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   bitDepth: number,
 *   colorType: number,
 *   rgba: Uint8Array,
 * }} DecodedPng
 */

/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} PixelBounds
 * @typedef {{ top: number, middle: number, bottom: number }} BandCounts
 * @typedef {{
 *   width: number,
 *   height: number,
 *   bitDepth: number,
 *   colorType: number,
 *   totalPixels: number,
 *   litPixels: number,
 *   transparentPixels: number,
 *   opaquePixels: number,
 *   greenDominantLitPixels: number,
 *   litBounds: PixelBounds | null,
 *   litBandCounts: BandCounts,
 * }} FramebufferStats
 */

/**
 * @typedef {{
 *   totalPixels: number,
 *   changedPixels: number,
 *   alphaChangedPixels: number,
 *   changedBounds: PixelBounds | null,
 *   changedBandCounts: BandCounts,
 * }} FramebufferDiff
 */

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number}
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * @param {number} colorType
 * @returns {number}
 */
function channelsForColorType(colorType) {
  switch (colorType) {
    case 0:
      return 1; // Grayscale
    case 2:
      return 3; // RGB
    case 4:
      return 2; // Grayscale + Alpha
    case 6:
      return 4; // RGBA
    default:
      throw new Error(`Unsupported PNG colorType ${colorType}`);
  }
}

/**
 * Decode an uncompressed or zlib-compressed non-interlaced 8-bit PNG into RGBA pixels.
 * @param {Buffer | Uint8Array} input
 * @returns {DecodedPng}
 */
export function decodePngRgba(input) {
  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawIhdr = false;
  let sawIend = false;
  /** @type {Buffer[]} */
  const idatChunks = [];

  let offset = 8;
  while (offset < buf.length) {
    if (offset + 12 > buf.length) {
      throw new Error("Truncated PNG chunk header");
    }
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      throw new Error(`Truncated PNG chunk "${type}"`);
    }
    const data = buf.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (!sawIhdr) {
      if (type !== "IHDR") {
        throw new Error(`Expected IHDR first, got "${type}"`);
      }
      if (data.length !== 13) {
        throw new Error(`Invalid IHDR length ${data.length}`);
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const compression = data.readUInt8(10);
      const filter = data.readUInt8(11);
      const interlace = data.readUInt8(12);
      if (width === 0 || height === 0) {
        throw new Error(`Invalid PNG dimensions ${width}x${height}`);
      }
      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bitDepth ${bitDepth} (expected 8)`);
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(
          `Unsupported PNG flags compression=${compression} filter=${filter} interlace=${interlace}`,
        );
      }
      sawIhdr = true;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIhdr || !sawIend || idatChunks.length === 0) {
    throw new Error("Incomplete PNG stream (missing IHDR, IDAT, or IEND)");
  }

  const channels = channelsForColorType(colorType);
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * channels;
  const expectedLength = height * (1 + rowBytes);
  if (inflated.length !== expectedLength) {
    throw new Error(
      `Unexpected inflated PNG byte length ${inflated.length} (expected ${expectedLength})`,
    );
  }

  const unfiltered = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const srcRowStart = y * (1 + rowBytes);
    const filterType = inflated[srcRowStart] ?? 0;
    const dstRowStart = y * rowBytes;
    const prevRowStart = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const rawByte = inflated[srcRowStart + 1 + x] ?? 0;
      const a =
        x >= channels ? (unfiltered[dstRowStart + x - channels] ?? 0) : 0;
      const b = y > 0 ? (unfiltered[prevRowStart + x] ?? 0) : 0;
      const c =
        x >= channels && y > 0
          ? (unfiltered[prevRowStart + x - channels] ?? 0)
          : 0;

      /** @type {number} */
      let value;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = (rawByte + a) & 0xff;
          break;
        case 2:
          value = (rawByte + b) & 0xff;
          break;
        case 3:
          value = (rawByte + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          value = (rawByte + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG scanline filter ${filterType}`);
      }
      unfiltered[dstRowStart + x] = value;
    }
  }

  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);
  if (colorType === 6) {
    rgba.set(unfiltered);
  } else {
    for (let i = 0; i < pixelCount; i += 1) {
      const src = i * channels;
      const dst = i * 4;
      if (colorType === 2) {
        rgba[dst] = unfiltered[src] ?? 0;
        rgba[dst + 1] = unfiltered[src + 1] ?? 0;
        rgba[dst + 2] = unfiltered[src + 2] ?? 0;
        rgba[dst + 3] = 255;
      } else if (colorType === 4) {
        const gray = unfiltered[src] ?? 0;
        rgba[dst] = gray;
        rgba[dst + 1] = gray;
        rgba[dst + 2] = gray;
        rgba[dst + 3] = unfiltered[src + 1] ?? 0;
      } else {
        const gray = unfiltered[src] ?? 0;
        rgba[dst] = gray;
        rgba[dst + 1] = gray;
        rgba[dst + 2] = gray;
        rgba[dst + 3] = 255;
      }
    }
  }

  return { width, height, bitDepth, colorType, rgba };
}

/**
 * Classify y into top/middle/bottom horizontal thirds of the display.
 * @param {number} y
 * @param {number} height
 * @returns {"top" | "middle" | "bottom"}
 */
function bandForY(y, height) {
  const third = height / 3;
  if (y < third) return "top";
  if (y < third * 2) return "middle";
  return "bottom";
}

/**
 * Analyze a 576x288 RGBA glasses framebuffer screenshot.
 * @param {DecodedPng} png
 * @returns {FramebufferStats}
 */
export function analyzeGlassesFramebuffer(png) {
  if (png.width !== 576 || png.height !== 288) {
    throw new Error(
      `Expected 576x288 glasses PNG, got ${png.width}x${png.height}`,
    );
  }
  if (png.colorType !== 6 || png.bitDepth !== 8) {
    throw new Error(
      `Expected 8-bit RGBA PNG (colorType=6, bitDepth=8), got colorType=${png.colorType} bitDepth=${png.bitDepth}`,
    );
  }

  const totalPixels = png.width * png.height;
  let litPixels = 0;
  let transparentPixels = 0;
  let opaquePixels = 0;
  let greenDominantLitPixels = 0;
  /** @type {PixelBounds | null} */
  let litBounds = null;
  const litBandCounts = { top: 0, middle: 0, bottom: 0 };

  for (let y = 0; y < png.height; y += 1) {
    const band = bandForY(y, png.height);
    for (let x = 0; x < png.width; x += 1) {
      const idx = (y * png.width + x) * 4;
      const r = png.rgba[idx] ?? 0;
      const g = png.rgba[idx + 1] ?? 0;
      const b = png.rgba[idx + 2] ?? 0;
      const a = png.rgba[idx + 3] ?? 0;

      if (a === 0) {
        transparentPixels += 1;
        continue;
      }

      litPixels += 1;
      if (a === 255) {
        opaquePixels += 1;
      }
      if (g > 0 && g >= r && g >= b) {
        greenDominantLitPixels += 1;
      }
      litBandCounts[band] += 1;

      if (!litBounds) {
        litBounds = { minX: x, minY: y, maxX: x, maxY: y };
      } else {
        if (x < litBounds.minX) litBounds.minX = x;
        if (y < litBounds.minY) litBounds.minY = y;
        if (x > litBounds.maxX) litBounds.maxX = x;
        if (y > litBounds.maxY) litBounds.maxY = y;
      }
    }
  }

  return {
    width: png.width,
    height: png.height,
    bitDepth: png.bitDepth,
    colorType: png.colorType,
    totalPixels,
    litPixels,
    transparentPixels,
    opaquePixels,
    greenDominantLitPixels,
    litBounds,
    litBandCounts,
  };
}

/**
 * Pixel-by-pixel RGBA diff between two identically sized decoded PNG frames.
 * @param {DecodedPng} before
 * @param {DecodedPng} after
 * @returns {FramebufferDiff}
 */
export function diffRgbaBuffers(before, after) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Cannot diff mismatched dimensions ${before.width}x${before.height} vs ${after.width}x${after.height}`,
    );
  }

  const totalPixels = before.width * before.height;
  let changedPixels = 0;
  let alphaChangedPixels = 0;
  /** @type {PixelBounds | null} */
  let changedBounds = null;
  const changedBandCounts = { top: 0, middle: 0, bottom: 0 };

  for (let y = 0; y < before.height; y += 1) {
    const band = bandForY(y, before.height);
    for (let x = 0; x < before.width; x += 1) {
      const idx = (y * before.width + x) * 4;
      const r1 = before.rgba[idx] ?? 0;
      const g1 = before.rgba[idx + 1] ?? 0;
      const b1 = before.rgba[idx + 2] ?? 0;
      const a1 = before.rgba[idx + 3] ?? 0;
      const r2 = after.rgba[idx] ?? 0;
      const g2 = after.rgba[idx + 1] ?? 0;
      const b2 = after.rgba[idx + 2] ?? 0;
      const a2 = after.rgba[idx + 3] ?? 0;

      if (r1 === r2 && g1 === g2 && b1 === b2 && a1 === a2) {
        continue;
      }

      changedPixels += 1;
      if (a1 !== a2) {
        alphaChangedPixels += 1;
      }
      changedBandCounts[band] += 1;

      if (!changedBounds) {
        changedBounds = { minX: x, minY: y, maxX: x, maxY: y };
      } else {
        if (x < changedBounds.minX) changedBounds.minX = x;
        if (y < changedBounds.minY) changedBounds.minY = y;
        if (x > changedBounds.maxX) changedBounds.maxX = x;
        if (y > changedBounds.maxY) changedBounds.maxY = y;
      }
    }
  }

  return {
    totalPixels,
    changedPixels,
    alphaChangedPixels,
    changedBounds,
    changedBandCounts,
  };
}

/**
 * Verify that an image (e.g. WebView capture) is not a single uniform flat color.
 * @param {DecodedPng} png
 * @returns {boolean}
 */
export function hasImageVariance(png) {
  const totalPixels = png.width * png.height;
  if (totalPixels === 0) return false;
  const step = Math.max(1, Math.floor(totalPixels / 4000));
  const firstR = png.rgba[0] ?? 0;
  const firstG = png.rgba[1] ?? 0;
  const firstB = png.rgba[2] ?? 0;
  const firstA = png.rgba[3] ?? 0;
  for (let i = step; i < totalPixels; i += step) {
    const idx = i * 4;
    if (
      (png.rgba[idx] ?? 0) !== firstR ||
      (png.rgba[idx + 1] ?? 0) !== firstG ||
      (png.rgba[idx + 2] ?? 0) !== firstB ||
      (png.rgba[idx + 3] ?? 0) !== firstA
    ) {
      return true;
    }
  }
  return false;
}
