// Extracts a dominant vivid hue (0-360) from an album-artwork image.
// Returns null when the image can't be loaded at all. Album covers often
// skew low-saturation (sepia photos, muted palettes), so the matcher uses
// permissive thresholds and falls back to "any colored pixel" if no vivid
// hue survives the strict pass.

const SAMPLE_SIZE = 64
const HUE_BUCKETS = 24

export interface ArtworkPalette {
  hue: number
  saturation: number
  lightness: number
  isNeutral: boolean
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60

  return [h, s, l]
}

export async function extractArtworkPalette(dataUrl: string): Promise<ArtworkPalette | null> {
  if (!dataUrl) return null

  const img = await loadImage(dataUrl)
  if (!img) return null

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  let pixels: Uint8ClampedArray
  try {
    pixels = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    return null
  }

  const summary = summarizePalette(pixels)
  if (!summary) return null

  // Pass 1: prefer vivid colors.
  let hue = scoreBuckets(pixels, 0.25, 0.08, 0.92)
  if (hue === null) {
    // Pass 2: accept muted colors (sepia/brown covers).
    hue = scoreBuckets(pixels, 0.08, 0.05, 0.95)
  }
  if (hue === null) {
    // Pass 3: take any non-gray pixel we can find.
    hue = scoreBuckets(pixels, 0.02, 0.02, 0.98)
  }

  const isNeutral = hue === null || summary.avgSaturation < 0.12 || summary.maxSaturation < 0.18
  return {
    hue: hue ?? summary.avgHue ?? 210,
    saturation: isNeutral
      ? clamp(summary.avgSaturation * 0.8 + 0.02, 0.02, 0.14)
      : clamp(0.38 + summary.avgSaturation * 0.45, 0.38, 0.82),
    lightness: clamp(0.4 + summary.avgLightness * 0.28, 0.36, 0.76),
    isNeutral,
  }
}

function scoreBuckets(
  pixels: Uint8ClampedArray,
  minSat: number,
  minLight: number,
  maxLight: number,
): number | null {
  const buckets = new Float64Array(HUE_BUCKETS)
  const bucketHueSum = new Float64Array(HUE_BUCKETS)

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < 32) continue

    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)

    if (s < minSat) continue
    if (l < minLight || l > maxLight) continue

    // Weight colors near mid-lightness highest so very dark / very bright
    // pixels don't dominate.
    const lightnessWeight = Math.max(0.1, 1 - Math.abs(l - 0.55) * 1.4)
    const weight = (s + 0.1) * (s + 0.1) * lightnessWeight

    const bucket = Math.floor((h / 360) * HUE_BUCKETS) % HUE_BUCKETS
    buckets[bucket] += weight
    bucketHueSum[bucket] += h * weight
  }

  let bestBucket = -1
  let bestWeight = 0
  for (let i = 0; i < HUE_BUCKETS; i++) {
    if (buckets[i] > bestWeight) {
      bestWeight = buckets[i]
      bestBucket = i
    }
  }

  if (bestBucket < 0 || bestWeight <= 0) return null
  return bucketHueSum[bestBucket] / buckets[bestBucket]
}

function summarizePalette(pixels: Uint8ClampedArray): {
  avgHue: number | null
  avgSaturation: number
  avgLightness: number
  maxSaturation: number
} | null {
  let pixelWeightSum = 0
  let satSum = 0
  let lightSum = 0
  let maxSaturation = 0
  let hueX = 0
  let hueY = 0
  let hueWeightSum = 0

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < 32) continue

    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])
    const pixelWeight = a / 255
    pixelWeightSum += pixelWeight
    satSum += s * pixelWeight
    lightSum += l * pixelWeight
    maxSaturation = Math.max(maxSaturation, s)

    const hueWeight = pixelWeight * Math.max(0.02, s)
    const rad = (h * Math.PI) / 180
    hueX += Math.cos(rad) * hueWeight
    hueY += Math.sin(rad) * hueWeight
    hueWeightSum += hueWeight
  }

  if (pixelWeightSum <= 0) return null

  return {
    avgHue: hueWeightSum > 0
      ? ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360
      : null,
    avgSaturation: satSum / pixelWeightSum,
    avgLightness: lightSum / pixelWeightSum,
    maxSaturation,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
