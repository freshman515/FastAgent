import type { AudioFeatures } from './types'

// Use larger FFT for better frequency resolution.
// 1024-point FFT → 512 bins → each bin ≈ 43 Hz (at 44.1kHz).
// This gives much better separation between adjacent frequencies
// compared to 256-point (128 bins, ≈172 Hz per bin) which made
// neighboring bars highly correlated → "everything moves together".
const FFT_SIZE = 1024

const BEAT_THRESHOLD = 1.4
const BEAT_COOLDOWN = 200
const ENERGY_HISTORY_SIZE = 30
const SPECTRUM_SIZE = 48

export class AudioAnalyzer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null

  private freqData: Uint8Array = new Uint8Array(0)
  private timeData: Uint8Array = new Uint8Array(0)

  private bassHistory: number[] = []
  private lastBeatTime = 0

  get connected(): boolean {
    return this.analyser !== null
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    })

    for (const track of stream.getVideoTracks()) {
      track.stop()
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      throw new Error('No audio track captured')
    }

    this.stream = new MediaStream(audioTracks)
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = FFT_SIZE

    // LOW smoothing — let the raw FFT data through so each bin responds
    // independently per frame. We do our own per-bar smoothing in the renderer
    // with different attack/release per frequency band.
    // 0.75 (old value) made all bins converge to the same average.
    this.analyser.smoothingTimeConstant = 0.3

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)

    const bins = this.analyser.frequencyBinCount
    this.freqData = new Uint8Array(bins)
    this.timeData = new Uint8Array(bins)
    this.bassHistory = []
  }

  disconnect(): void {
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.ctx?.close()
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }
    this.source = null
    this.analyser = null
    this.ctx = null
    this.stream = null
    this.freqData = new Uint8Array(0)
    this.timeData = new Uint8Array(0)
    this.bassHistory = []
  }

  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, beat: false, spectrum: [], dominantBand: 0 }
    }

    this.analyser.getByteFrequencyData(this.freqData)
    this.analyser.getByteTimeDomainData(this.timeData)

    const bins = this.freqData.length // 512 bins with FFT_SIZE=1024

    // Frequency band boundaries (for 44.1kHz, each bin ≈ 43 Hz)
    const bassEnd = Math.floor(bins * 0.04)   // ~0-880 Hz (bass/sub-bass)
    const midEnd = Math.floor(bins * 0.2)     // ~880-4300 Hz (vocals/melody)

    let bassSum = 0
    let midSum = 0
    let trebleSum = 0
    let totalSum = 0
    let maxVal = 0
    let maxBin = 0

    for (let i = 0; i < bins; i++) {
      const v = this.freqData[i]
      totalSum += v
      if (i < bassEnd) bassSum += v
      else if (i < midEnd) midSum += v
      else trebleSum += v

      if (v > maxVal) {
        maxVal = v
        maxBin = i
      }
    }

    const bass = bassEnd > 0 ? bassSum / (bassEnd * 255) : 0
    const mid = (midEnd - bassEnd) > 0 ? midSum / ((midEnd - bassEnd) * 255) : 0
    const treble = (bins - midEnd) > 0 ? trebleSum / ((bins - midEnd) * 255) : 0
    const volume = totalSum / (bins * 255)

    // ── Logarithmic spectrum mapping ──
    //
    // Maps 512 FFT bins → 48 visualization bars using logarithmic grouping.
    //
    // Why log: Human pitch perception is logarithmic. An octave (doubling of
    // frequency) should get equal visual space. Linear mapping crams all the
    // musically interesting content (bass, vocals, melody) into the first
    // few bars and wastes the rest on ultrasonic frequencies.
    //
    // With pow(frac, 2.0):
    //   bar 0  → bins 0-0    (≈ 0-43 Hz, sub-bass)
    //   bar 12 → bins 3-4    (≈ 130-170 Hz, bass)
    //   bar 24 → bins 12-15  (≈ 520-650 Hz, mid)
    //   bar 36 → bins 28-33  (≈ 1200-1400 Hz, upper mid)
    //   bar 47 → bins 460-512 (≈ 20000-22050 Hz, air)
    //
    // Each bar independently reads its own FFT bin range — no global
    // normalization, no shared state between bars.

    const spectrum: number[] = []

    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      const startFrac = i / SPECTRUM_SIZE
      const endFrac = (i + 1) / SPECTRUM_SIZE
      const start = Math.floor(Math.pow(startFrac, 2.0) * bins)
      const end = Math.max(start + 1, Math.floor(Math.pow(endFrac, 2.0) * bins))

      // Use PEAK within the bin range (not average).
      // Average causes adjacent bars to blur together when one bin range
      // contains a strong peak and several quiet bins — the peak gets diluted.
      // Peak preserves the distinctness of each frequency band.
      let peak = 0
      for (let j = start; j < end && j < bins; j++) {
        if (this.freqData[j] > peak) peak = this.freqData[j]
      }
      let val = peak / 255

      // Moderate high-frequency gain compensation.
      // High frequencies have less physical energy but are perceptually important.
      // Gentle ramp: 1.0x at bar 0 → 1.8x at bar 47.
      // (Previous 2.5x was too aggressive, making everything equal height.)
      const t = i / SPECTRUM_SIZE
      const freqCompensation = 1.0 + t * 0.8
      val *= freqCompensation

      // Power compression: pow(x, 0.7) gently compresses dynamic range.
      // 0.6 was too aggressive (everything looked the same height).
      // 0.7 keeps visible differences between loud and quiet bands.
      val = Math.pow(Math.min(1, val), 0.7)

      spectrum.push(val)
    }

    // Beat detection
    this.bassHistory.push(bass)
    if (this.bassHistory.length > ENERGY_HISTORY_SIZE) {
      this.bassHistory.shift()
    }

    const avgBass = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length
    const now = performance.now()
    const beat = bass > avgBass * BEAT_THRESHOLD
      && bass > 0.15
      && now - this.lastBeatTime > BEAT_COOLDOWN

    if (beat) {
      this.lastBeatTime = now
    }

    return { volume, bass, mid, treble, beat, spectrum, dominantBand: maxBin }
  }
}
