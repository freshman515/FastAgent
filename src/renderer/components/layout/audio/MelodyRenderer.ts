import type { AudioFeatures, Particle, VisualParams, VisualizerMode } from './types'

const MAX_PARTICLES = 40
const CURVE_SEGMENTS = 64
const CURVE_COUNT = 3
const BARS_COUNT = 48

// ─── Animation Mapper ───
// Maps raw AudioFeatures → smoothed VisualParams

class AnimationMapper {
  private smoothVolume = 0
  private smoothBass = 0
  private smoothMid = 0
  private smoothTreble = 0
  private hue = 200

  map(features: AudioFeatures): VisualParams {
    const { volume, bass, mid, treble, beat, dominantBand } = features

    // Smooth all values to prevent jitter
    this.smoothVolume += (volume - this.smoothVolume) * 0.15
    this.smoothBass += (bass - this.smoothBass) * 0.2
    this.smoothMid += (mid - this.smoothMid) * 0.12
    this.smoothTreble += (treble - this.smoothTreble) * 0.1

    // Hue shifts based on dominant frequency band
    const targetHue = 180 + (dominantBand / 128) * 180 // 180-360 (cyan → magenta)
    this.hue += (targetHue - this.hue) * 0.03

    return {
      amplitude: 0.3 + this.smoothVolume * 0.7 + this.smoothBass * 0.4,
      flowSpeed: 0.8 + this.smoothMid * 1.2,
      hue: this.hue,
      glowIntensity: 0.3 + this.smoothBass * 0.7,
      particleBurst: beat,
      bassImpact: this.smoothBass,
      trebleShimmer: this.smoothTreble,
      lineWidth: 1.2 + this.smoothVolume * 1.0,
    }
  }
}

// ─── Melody Renderer ───
// Multi-layer canvas renderer: glow → curves → particles → sparkles

export class MelodyRenderer {
  private mapper = new AnimationMapper()
  private particles: Particle[] = []
  private time = 0
  private curvePhases: number[] = Array.from({ length: CURVE_COUNT }, (_, i) => i * 2.1)
  private smoothBars: number[] = Array.from({ length: BARS_COUNT }, () => 0)

  mode: VisualizerMode = 'melody'

  render(ctx: CanvasRenderingContext2D, w: number, h: number, features: AudioFeatures): void {
    const params = this.mapper.map(features)
    this.time += 0.016 * params.flowSpeed

    ctx.clearRect(0, 0, w, h)

    if (this.mode === 'bars') {
      this.renderBars(ctx, w, h, params, features)
    } else {
      this.renderGlow(ctx, w, h, params)
      this.renderCurves(ctx, w, h, params, features.spectrum)
      this.updateAndRenderParticles(ctx, w, h, params)
      this.renderSparkles(ctx, w, h, params)
    }
  }

  /** Render idle animation when no audio is connected */
  renderIdle(ctx: CanvasRenderingContext2D, w: number, h: number, playing: boolean): void {
    this.time += 0.008

    ctx.clearRect(0, 0, w, h)

    if (!playing) {
      if (this.mode === 'bars') {
        this.renderIdleBars(ctx, w, h)
      } else {
        ctx.strokeStyle = 'hsla(200, 30%, 50%, 0.2)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = 0; x < w; x++) {
          const y = h * 0.7 + Math.sin(x * 0.04 + this.time) * 2
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      return
    }

    // Simulated idle visualization when playing but not connected to audio
    const fakeFeatures: AudioFeatures = {
      volume: 0.3 + Math.sin(this.time * 1.5) * 0.15,
      bass: 0.25 + Math.sin(this.time * 2.3) * 0.15,
      mid: 0.3 + Math.sin(this.time * 1.8) * 0.1,
      treble: 0.2 + Math.sin(this.time * 3.1) * 0.1,
      beat: false,
      spectrum: Array.from({ length: 32 }, (_, i) =>
        0.15 + Math.sin(i * 0.5 + this.time * 2) * 0.1 + Math.random() * 0.05,
      ),
      dominantBand: 30,
    }
    this.render(ctx, w, h, fakeFeatures)
  }

  // ── Layer 1: Background Glow ──

  private renderGlow(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
  ): void {
    const { hue, glowIntensity, bassImpact } = params
    const cx = w * 0.5
    const cy = h * 0.6
    const radius = w * 0.35 + bassImpact * w * 0.15

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, `hsla(${hue}, 70%, 55%, ${glowIntensity * 0.15})`)
    grad.addColorStop(0.5, `hsla(${hue + 30}, 60%, 45%, ${glowIntensity * 0.06})`)
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // ── Layer 2: Flowing Curves ──

  private renderCurves(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
    spectrum: number[],
  ): void {
    const { amplitude, hue, lineWidth } = params
    const baseY = h * 0.65

    for (let c = 0; c < CURVE_COUNT; c++) {
      this.curvePhases[c] += 0.01 * (1 + c * 0.3) * params.flowSpeed

      const alpha = 0.6 - c * 0.15
      const curveHue = hue + c * 25
      const curveAmp = amplitude * (1 - c * 0.2) * h * 0.45

      ctx.save()
      ctx.shadowBlur = 6 + params.glowIntensity * 8
      ctx.shadowColor = `hsla(${curveHue}, 80%, 60%, ${alpha * 0.6})`
      ctx.strokeStyle = `hsla(${curveHue}, 75%, 65%, ${alpha})`
      ctx.lineWidth = lineWidth - c * 0.3
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      ctx.beginPath()
      for (let i = 0; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS
        const x = t * w

        // Blend multiple sine frequencies for organic shape
        const phase = this.curvePhases[c]
        const s1 = Math.sin(t * Math.PI * 2 + phase) * 0.5
        const s2 = Math.sin(t * Math.PI * 4.5 + phase * 1.3) * 0.25
        const s3 = Math.sin(t * Math.PI * 7 + phase * 0.7) * 0.15

        // Mix in spectrum data for reactivity
        const specIdx = Math.floor(t * (spectrum.length - 1))
        const specVal = spectrum[specIdx] ?? 0
        const specInfluence = (specVal - 0.15) * 0.6

        const y = baseY - (s1 + s2 + s3 + specInfluence) * curveAmp

        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  // ── Layer 3: Particles ──

  private updateAndRenderParticles(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
  ): void {
    // Spawn particles on beat
    if (params.particleBurst) {
      const count = 4 + Math.floor(params.bassImpact * 6)
      for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
        this.particles.push({
          x: Math.random() * w,
          y: h * (0.3 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 1.5,
          vy: -(0.5 + Math.random() * 1.5),
          life: 1,
          maxLife: 0.6 + Math.random() * 0.6,
          size: 1 + Math.random() * 1.5,
          hue: params.hue + (Math.random() - 0.5) * 40,
        })
      }
    }

    // Update & render
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= 0.016 / p.maxLife
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }

      p.x += p.vx
      p.y += p.vy
      p.vy -= 0.02 // slight upward drift

      const alpha = p.life * 0.8
      ctx.save()
      ctx.shadowBlur = 4
      ctx.shadowColor = `hsla(${p.hue}, 80%, 70%, ${alpha})`
      ctx.fillStyle = `hsla(${p.hue}, 80%, 75%, ${alpha})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // ── Layer 4: Treble Sparkles ──

  private renderSparkles(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
  ): void {
    if (params.trebleShimmer < 0.15) return

    const count = Math.floor(params.trebleShimmer * 8)
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w
      const y = Math.random() * h * 0.8
      const alpha = params.trebleShimmer * (0.3 + Math.random() * 0.4)
      const size = 0.5 + Math.random() * 0.8

      ctx.fillStyle = `hsla(${params.hue + 60}, 90%, 85%, ${alpha})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Bars Mode: Spectrum Bars ──

  private renderBars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: VisualParams,
    features: AudioFeatures,
  ): void {
    const { spectrum, bass, beat } = features
    const { hue, bassImpact } = params

    const gap = 1.5
    const barW = (w - gap * (BARS_COUNT - 1)) / BARS_COUNT
    const maxH = h - 2

    // Resample spectrum to BARS_COUNT bins
    const step = spectrum.length / BARS_COUNT

    for (let i = 0; i < BARS_COUNT; i++) {
      // Sample spectrum with interpolation
      const srcIdx = i * step
      const lo = Math.floor(srcIdx)
      const hi = Math.min(lo + 1, spectrum.length - 1)
      const frac = srcIdx - lo
      const raw = (spectrum[lo] ?? 0) * (1 - frac) + (spectrum[hi] ?? 0) * frac

      // Boost low frequencies for visual impact
      const freqBoost = i < BARS_COUNT * 0.15 ? 1.3 : i < BARS_COUNT * 0.4 ? 1.1 : 1.0
      const target = Math.min(1, raw * freqBoost)

      // Smooth: fast attack, slow decay
      if (target > this.smoothBars[i]) {
        this.smoothBars[i] += (target - this.smoothBars[i]) * 0.45
      } else {
        this.smoothBars[i] += (target - this.smoothBars[i]) * 0.12
      }

      const val = this.smoothBars[i]
      const barH = Math.max(1, val * maxH)
      const x = i * (barW + gap)
      const y = h - barH

      // Color: hue shifts across frequency range, brightness tracks value
      const barHue = hue + (i / BARS_COUNT) * 60
      const lightness = 50 + val * 20
      const alpha = 0.55 + val * 0.45

      // Glow on beat
      if (beat && i < BARS_COUNT * 0.3) {
        ctx.save()
        ctx.shadowBlur = 8 + bassImpact * 6
        ctx.shadowColor = `hsla(${barHue}, 85%, 60%, ${alpha * 0.7})`
        ctx.fillStyle = `hsla(${barHue}, 85%, ${lightness + 10}%, ${Math.min(1, alpha + 0.2)})`
        ctx.fillRect(x, y, barW, barH)
        ctx.restore()
      } else {
        ctx.fillStyle = `hsla(${barHue}, 75%, ${lightness}%, ${alpha})`
        ctx.fillRect(x, y, barW, barH)
      }

      // Bright cap on top of each bar
      if (barH > 3) {
        const capH = 1.5
        ctx.fillStyle = `hsla(${barHue}, 90%, 80%, ${0.6 + val * 0.4})`
        ctx.fillRect(x, y, barW, capH)
      }
    }

    // Bass pulse overlay
    if (bass > 0.3) {
      const pulseAlpha = (bass - 0.3) * 0.12
      const grad = ctx.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, `hsla(${hue}, 70%, 50%, ${pulseAlpha})`)
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }
  }

  private renderIdleBars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gap = 1.5
    const barW = (w - gap * (BARS_COUNT - 1)) / BARS_COUNT

    for (let i = 0; i < BARS_COUNT; i++) {
      // Decay to small idle height
      this.smoothBars[i] += (0.03 - this.smoothBars[i]) * 0.05
      const barH = Math.max(1, this.smoothBars[i] * (h - 2))
      const x = i * (barW + gap)
      const y = h - barH
      ctx.fillStyle = 'hsla(200, 30%, 50%, 0.2)'
      ctx.fillRect(x, y, barW, barH)
    }
  }
}
