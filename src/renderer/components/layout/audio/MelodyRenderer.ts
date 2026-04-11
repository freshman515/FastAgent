import type { AudioFeatures, Particle, VisualParams, VisualizerMode } from './types'

const MAX_PARTICLES = 40

// ─── Bars: Adaptive Density ───

const BAR_MIN_WIDTH = 3
const BAR_MIN_GAP = 1
const TARGET_BAR_PITCH = 5
const MIN_BARS = 8
const MAX_BARS = 72
const SMOOTH_BUFFER_SIZE = MAX_BARS

// ─── Ribbon: Overshoot ───

const RIBBON_OVERSHOOT = 0.18
const RIBBON_PAD_POINTS = 3

// ─── Energy Ribbon Architecture ───

interface RibbonLayer {
  bandStart: number
  bandEnd: number
  controlPoints: number
  attack: number
  release: number
  amplitude: number
  baseline: number
  ribbonHalf: number
  ribbonGrow: number
  edgeWidth: number
  alpha: number
  fillAlpha: number
  hueShift: number
  glow: number
  driftSpeed: number
  skeletonWeight: number
  flowSpread: number
}

const RIBBON_LAYERS: RibbonLayer[] = [
  {
    // Foundation — bass
    bandStart: 0,
    bandEnd: 0.3,
    controlPoints: 10,
    attack: 0.18,
    release: 0.045,
    amplitude: 0.9,
    baseline: 0.62,
    ribbonHalf: 4,
    ribbonGrow: 6,
    edgeWidth: 1.2,
    alpha: 0.3,
    fillAlpha: 0.35,
    hueShift: -15,
    glow: 14,
    driftSpeed: 0.2,
    skeletonWeight: 0.38,
    flowSpread: 1.2,
  },
  {
    // Primary — mid
    bandStart: 0.15,
    bandEnd: 0.65,
    controlPoints: 20,
    attack: 0.28,
    release: 0.09,
    amplitude: 0.75,
    baseline: 0.6,
    ribbonHalf: 2.5,
    ribbonGrow: 4,
    edgeWidth: 1.6,
    alpha: 0.8,
    fillAlpha: 0.2,
    hueShift: 0,
    glow: 8,
    driftSpeed: 0.45,
    skeletonWeight: 0.28,
    flowSpread: 1.8,
  },
  {
    // Detail — treble
    bandStart: 0.5,
    bandEnd: 1.0,
    controlPoints: 26,
    attack: 0.42,
    release: 0.16,
    amplitude: 0.45,
    baseline: 0.58,
    ribbonHalf: 1,
    ribbonGrow: 2,
    edgeWidth: 0.8,
    alpha: 0.4,
    fillAlpha: 0.1,
    hueShift: 30,
    glow: 4,
    driftSpeed: 0.75,
    skeletonWeight: 0.18,
    flowSpread: 2.5,
  },
]

// ─── Animation Mapper ───

class AnimationMapper {
  smoothVolume = 0
  smoothBass = 0
  smoothMid = 0
  smoothTreble = 0
  hue = 200

  map(features: AudioFeatures): VisualParams {
    const { volume, bass, mid, treble, dominantBand } = features

    this.smoothVolume += (volume - this.smoothVolume) * 0.15
    this.smoothBass += (bass - this.smoothBass) * 0.2
    this.smoothMid += (mid - this.smoothMid) * 0.12
    this.smoothTreble += (treble - this.smoothTreble) * 0.1

    const targetHue = 180 + (dominantBand / 128) * 180
    this.hue += (targetHue - this.hue) * 0.03

    return {
      amplitude: 0.55 + this.smoothVolume * 0.45 + this.smoothBass * 0.3,
      flowSpeed: 0.8 + this.smoothMid * 1.2,
      hue: this.hue,
      glowIntensity: 0.3 + this.smoothBass * 0.7,
      particleBurst: features.beat,
      bassImpact: this.smoothBass,
      trebleShimmer: this.smoothTreble,
      lineWidth: 1.2 + this.smoothVolume * 1.0,
    }
  }
}

// ─── Melody Renderer ───

export class MelodyRenderer {
  private mapper = new AnimationMapper()
  private particles: Particle[] = []
  private time = 0
  private smoothBars: number[] = Array.from({ length: SMOOTH_BUFFER_SIZE }, () => 0)

  private layerSmoothed: number[][] = RIBBON_LAYERS.map((l) =>
    Array.from({ length: l.controlPoints + RIBBON_PAD_POINTS * 2 }, () => 0),
  )
  private layerPhase: number[] = RIBBON_LAYERS.map(() => 0)

  mode: VisualizerMode = 'melody'

  render(ctx: CanvasRenderingContext2D, w: number, h: number, features: AudioFeatures): void {
    const params = this.mapper.map(features)
    this.time += 0.016 * params.flowSpeed

    ctx.clearRect(0, 0, w, h)

    if (this.mode === 'bars') {
      this.renderBars(ctx, w, h, params, features)
    } else {
      this.renderGlow(ctx, w, h, params)
      this.renderRibbonLayers(ctx, w, h, params, features)
      this.updateAndRenderParticles(ctx, w, h, params)
      this.renderSparkles(ctx, w, h, params)
    }
    this.renderEdgeFade(ctx, w, h)
  }

  renderIdle(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h)

    if (this.mode === 'bars') {
      const { count, barWidth, slotWidth } = computeBarsLayout(w)
      const maxH = h - 2
      for (let i = 0; i < count; i++) {
        this.smoothBars[i] += (0 - this.smoothBars[i]) * 0.06
        if (this.smoothBars[i] < 0.005) this.smoothBars[i] = 0
        const val = this.smoothBars[i]
        if (val <= 0.01) continue
        const barH = Math.max(1.25, val * maxH)
        const x = i * slotWidth + (slotWidth - barWidth) / 2
        ctx.fillStyle = 'hsla(200, 30%, 50%, 0.15)'
        ctx.fillRect(x, h - barH, barWidth, barH)
      }
    } else {
      for (let li = 0; li < RIBBON_LAYERS.length; li++) {
        const sm = this.layerSmoothed[li]
        for (let j = 0; j < sm.length; j++) {
          sm[j] += (0 - sm[j]) * 0.04
          if (sm[j] < 0.003) sm[j] = 0
        }
        this.layerPhase[li] += 0.006 * RIBBON_LAYERS[li].driftSpeed
      }
      this.time += 0.006
      for (let li = 0; li < RIBBON_LAYERS.length; li++) {
        this.drawRibbon(ctx, w, h, RIBBON_LAYERS[li], this.layerSmoothed[li], li, 0.3)
      }
    }
    this.renderEdgeFade(ctx, w, h)
  }

  // ── Ribbon Layer Pipeline ──

  private renderRibbonLayers(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
    features: AudioFeatures,
  ): void {
    const { spectrum } = features

    for (let li = 0; li < RIBBON_LAYERS.length; li++) {
      const layer = RIBBON_LAYERS[li]
      const sm = this.layerSmoothed[li]
      const totalCp = layer.controlPoints + RIBBON_PAD_POINTS * 2

      this.layerPhase[li] += 0.016 * layer.driftSpeed * params.flowSpeed

      const bStart = Math.floor(layer.bandStart * spectrum.length)
      const bEnd = Math.ceil(layer.bandEnd * spectrum.length)
      const bLen = bEnd - bStart

      for (let cp = 0; cp < totalCp; cp++) {
        const normalizedT = (cp - RIBBON_PAD_POINTS) / (layer.controlPoints - 1)
        const specT = Math.max(0, Math.min(1, normalizedT))
        const srcIdx = bStart + specT * (bLen - 1)
        const lo = Math.floor(srcIdx)
        const hi = Math.min(lo + 1, spectrum.length - 1)
        const t = srcIdx - lo
        const raw = (spectrum[lo] ?? 0) * (1 - t) + (spectrum[hi] ?? 0) * t

        if (raw > sm[cp]) {
          sm[cp] += (raw - sm[cp]) * layer.attack
        } else {
          sm[cp] += (raw - sm[cp]) * layer.release
        }
      }

      this.drawRibbon(ctx, w, h, layer, sm, li, params.amplitude)
    }
  }

  // ── Ribbon Drawing (with overshoot) ──

  private drawRibbon(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layer: RibbonLayer,
    smoothed: number[],
    layerIndex: number,
    globalAmp: number,
  ): void {
    const phase = this.layerPhase[layerIndex]
    const visibleCp = layer.controlPoints
    const totalCp = visibleCp + RIBBON_PAD_POINTS * 2
    const amp = layer.amplitude * globalAmp * h
    const baseY = layer.baseline * h
    const hue = this.mapper.hue + layer.hueShift
    const segments = Math.max(80, visibleCp * 5)

    const cpYs: number[] = []
    const cpEnergy: number[] = []

    for (let i = 0; i < totalCp; i++) {
      const normalizedT = (i - RIBBON_PAD_POINTS) / (visibleCp - 1)
      const specRaw = smoothed[i]
      const specBoosted = Math.pow(Math.min(1, specRaw), 0.5)
      const localPhase = phase + normalizedT * layer.flowSpread

      const skeleton =
        Math.sin(normalizedT * Math.PI * 2.2 + localPhase) * 0.35 +
        Math.sin(normalizedT * Math.PI * 3.8 + localPhase * 1.5) * 0.18 +
        Math.sin(normalizedT * Math.PI * 6.3 + localPhase * 0.6) * 0.08

      const val = skeleton * layer.skeletonWeight + specBoosted * (1 - layer.skeletonWeight)
      cpYs.push(val)
      cpEnergy.push(specBoosted)
    }

    const xStart = -RIBBON_OVERSHOOT * w
    const xEnd = (1 + RIBBON_OVERSHOOT) * w
    const xRange = xEnd - xStart

    const centerYs: number[] = []
    const energyVals: number[] = []
    const xPositions: number[] = []

    for (let seg = 0; seg <= segments; seg++) {
      const segT = seg / segments
      const x = xStart + segT * xRange
      xPositions.push(x)

      const cpPos = RIBBON_PAD_POINTS + ((x / w) * (visibleCp - 1))
      const idx = Math.floor(cpPos)
      const frac = cpPos - idx

      const p0 = cpYs[clampIdx(idx - 1, totalCp)]
      const p1 = cpYs[clampIdx(idx, totalCp)]
      const p2 = cpYs[clampIdx(idx + 1, totalCp)]
      const p3 = cpYs[clampIdx(idx + 2, totalCp)]

      const val = catmullRom(p0, p1, p2, p3, frac)
      centerYs.push(baseY - val * amp)

      const e1 = cpEnergy[clampIdx(idx, totalCp)]
      const e2 = cpEnergy[clampIdx(idx + 1, totalCp)]
      energyVals.push(e1 + (e2 - e1) * Math.max(0, Math.min(1, frac)))
    }

    // Pass 1: Ribbon fill
    if (layer.fillAlpha > 0.01) {
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i <= segments; i++) {
        const energy = energyVals[i]
        const halfThick = layer.ribbonHalf + energy * layer.ribbonGrow
        const y = centerYs[i] - halfThick
        if (i === 0) ctx.moveTo(xPositions[i], y)
        else ctx.lineTo(xPositions[i], y)
      }
      for (let i = segments; i >= 0; i--) {
        const energy = energyVals[i]
        const halfThick = layer.ribbonHalf + energy * layer.ribbonGrow
        ctx.lineTo(xPositions[i], centerYs[i] + halfThick)
      }
      ctx.closePath()

      const gradY = baseY - amp * 0.5
      const gradH = amp * 1.0
      const grad = ctx.createLinearGradient(0, gradY, 0, gradY + gradH)
      const fillA = layer.fillAlpha * globalAmp
      grad.addColorStop(0, `hsla(${hue}, 70%, 60%, 0)`)
      grad.addColorStop(0.35, `hsla(${hue}, 70%, 60%, ${fillA * 0.7})`)
      grad.addColorStop(0.5, `hsla(${hue}, 70%, 65%, ${fillA})`)
      grad.addColorStop(0.65, `hsla(${hue}, 70%, 60%, ${fillA * 0.7})`)
      grad.addColorStop(1, `hsla(${hue}, 70%, 60%, 0)`)
      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()
    }

    // Pass 2: Edge stroke
    ctx.save()
    ctx.strokeStyle = `hsla(${hue}, 78%, 68%, ${layer.alpha})`
    ctx.lineWidth = layer.edgeWidth
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (layer.glow > 0) {
      ctx.shadowBlur = layer.glow * Math.max(0.4, globalAmp)
      ctx.shadowColor = `hsla(${hue}, 80%, 60%, ${layer.alpha * 0.45})`
    }

    ctx.beginPath()
    for (let i = 0; i <= segments; i++) {
      if (i === 0) ctx.moveTo(xPositions[i], centerYs[i])
      else ctx.lineTo(xPositions[i], centerYs[i])
    }
    ctx.stroke()

    // Pass 3: Peak highlight
    const peakThreshold = 0.4
    ctx.strokeStyle = `hsla(${hue}, 85%, 80%, ${layer.alpha * 0.6})`
    ctx.lineWidth = layer.edgeWidth * 0.6
    ctx.shadowBlur = layer.glow * 1.2 * Math.max(0.4, globalAmp)
    ctx.shadowColor = `hsla(${hue}, 85%, 70%, ${layer.alpha * 0.5})`

    let inPeak = false
    for (let i = 0; i <= segments; i++) {
      if (energyVals[i] > peakThreshold) {
        if (!inPeak) {
          ctx.beginPath()
          ctx.moveTo(xPositions[i], centerYs[i])
          inPeak = true
        } else {
          ctx.lineTo(xPositions[i], centerYs[i])
        }
      } else if (inPeak) {
        ctx.stroke()
        inPeak = false
      }
    }
    if (inPeak) ctx.stroke()
    ctx.restore()
  }

  // ── Edge Fade ──

  private renderEdgeFade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    const fadeW = Math.min(28, w * 0.14)

    const leftGrad = ctx.createLinearGradient(0, 0, fadeW, 0)
    leftGrad.addColorStop(0, 'rgba(0,0,0,1)')
    leftGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = leftGrad
    ctx.fillRect(0, 0, fadeW, h)

    const rightGrad = ctx.createLinearGradient(w - fadeW, 0, w, 0)
    rightGrad.addColorStop(0, 'rgba(0,0,0,0)')
    rightGrad.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = rightGrad
    ctx.fillRect(w - fadeW, 0, fadeW, h)

    ctx.restore()
  }

  // ── Background Glow ──

  private renderGlow(ctx: CanvasRenderingContext2D, w: number, h: number, params: VisualParams): void {
    const { hue, glowIntensity, bassImpact } = params
    const cx = w * 0.5
    const cy = h * 0.6
    const radius = w * 0.35 + bassImpact * w * 0.15

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, `hsla(${hue}, 70%, 55%, ${glowIntensity * 0.12})`)
    grad.addColorStop(0.5, `hsla(${hue + 30}, 60%, 45%, ${glowIntensity * 0.05})`)
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // ── Particles ──

  private updateAndRenderParticles(ctx: CanvasRenderingContext2D, w: number, h: number, params: VisualParams): void {
    if (params.particleBurst) {
      const count = 3 + Math.floor(params.bassImpact * 5)
      for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
        this.particles.push({
          x: Math.random() * w,
          y: h * (0.35 + Math.random() * 0.4),
          vx: (Math.random() - 0.5) * 1.2,
          vy: -(0.4 + Math.random() * 1.2),
          life: 1,
          maxLife: 0.6 + Math.random() * 0.6,
          size: 0.8 + Math.random() * 1.2,
          hue: params.hue + (Math.random() - 0.5) * 40,
        })
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= 0.016 / p.maxLife
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx
      p.y += p.vy
      p.vy -= 0.015

      const alpha = p.life * 0.7
      ctx.save()
      ctx.shadowBlur = 3
      ctx.shadowColor = `hsla(${p.hue}, 80%, 70%, ${alpha})`
      ctx.fillStyle = `hsla(${p.hue}, 80%, 75%, ${alpha})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // ── Treble Sparkles ──

  private renderSparkles(ctx: CanvasRenderingContext2D, w: number, h: number, params: VisualParams): void {
    if (params.trebleShimmer < 0.2) return
    const count = Math.floor(params.trebleShimmer * 6)
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w
      const y = h * (0.3 + Math.random() * 0.5)
      const alpha = params.trebleShimmer * (0.2 + Math.random() * 0.3)
      const size = 0.4 + Math.random() * 0.7
      ctx.fillStyle = `hsla(${params.hue + 60}, 90%, 85%, ${alpha})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Bars Mode: Adaptive Density ──

  private renderBars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
    features: AudioFeatures,
  ): void {
    const { spectrum, bass, beat } = features
    const { hue, bassImpact } = params

    const { count: barCount, barWidth, slotWidth } = computeBarsLayout(w)
    const maxH = h - 2
    const maxSpectrumIndex = Math.max(0, spectrum.length - 1)
    const center = (barCount - 1) / 2

    for (let i = 0; i < barCount; i++) {
      const distanceFromCenter = center > 0 ? Math.abs(i - center) / center : 0
      const frequencyT = Math.pow(distanceFromCenter, 1.25)
      const centerBias = 1 - distanceFromCenter
      const srcIdx = frequencyT * maxSpectrumIndex
      const lo = Math.floor(srcIdx)
      const hi = Math.min(lo + 1, maxSpectrumIndex)
      const frac = srcIdx - lo
      const raw = (spectrum[lo] ?? 0) * (1 - frac) + (spectrum[hi] ?? 0) * frac
      const target = Math.min(1, raw)

      const t = barCount > 1 ? i / (barCount - 1) : 0
      let attack: number
      let release: number
      if (frequencyT < 0.3) {
        attack = 0.25
        release = 0.06
      } else if (frequencyT < 0.65) {
        attack = 0.45
        release = 0.12
      } else {
        attack = 0.6
        release = 0.2
      }

      if (target > this.smoothBars[i]) {
        this.smoothBars[i] += (target - this.smoothBars[i]) * attack
      } else {
        this.smoothBars[i] += (target - this.smoothBars[i]) * release
      }

      const val = this.smoothBars[i]
      if (val <= 0.012) continue
      const barH = Math.max(1.25, val * maxH)
      const x = i * slotWidth + (slotWidth - barWidth) / 2
      const y = h - barH

      const barHue = hue + frequencyT * 60
      const lightness = 50 + val * 20
      const alpha = 0.55 + val * 0.45

      if (beat && centerBias > 0.68) {
        ctx.save()
        ctx.shadowBlur = 8 + bassImpact * 6
        ctx.shadowColor = `hsla(${barHue}, 85%, 60%, ${alpha * 0.7})`
        ctx.fillStyle = `hsla(${barHue}, 85%, ${lightness + 10}%, ${Math.min(1, alpha + 0.2)})`
        ctx.fillRect(x, y, barWidth, barH)
        ctx.restore()
      } else {
        ctx.fillStyle = `hsla(${barHue}, 75%, ${lightness}%, ${alpha})`
        ctx.fillRect(x, y, barWidth, barH)
      }

      if (barH > 3) {
        ctx.fillStyle = `hsla(${barHue}, 90%, 80%, ${0.6 + val * 0.4})`
        ctx.fillRect(x, y, barWidth, 1.5)
      }
    }

    if (bass > 0.3) {
      const pulseAlpha = (bass - 0.3) * 0.12
      const grad = ctx.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, `hsla(${hue}, 70%, 50%, ${pulseAlpha})`)
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }
  }
}

// ── Helpers ──

function computeBarsLayout(w: number): { count: number; barWidth: number; slotWidth: number } {
  const count = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(w / TARGET_BAR_PITCH)))
  const slotWidth = w / count
  const gap = Math.max(BAR_MIN_GAP, Math.min(2.5, slotWidth * 0.22))
  const barWidth = Math.max(BAR_MIN_WIDTH, slotWidth - gap)
  return { count, barWidth, slotWidth }
}

function clampIdx(i: number, len: number): number {
  return Math.max(0, Math.min(len - 1, i))
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}
