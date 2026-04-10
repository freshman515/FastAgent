import type { AudioFeatures } from './types'

const FFT_SIZE = 256
const BEAT_THRESHOLD = 1.4
const BEAT_COOLDOWN = 200 // ms
const ENERGY_HISTORY_SIZE = 30

export class AudioAnalyzer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null

  private freqData: Uint8Array = new Uint8Array(0)
  private timeData: Uint8Array = new Uint8Array(0)

  // Beat detection state
  private bassHistory: number[] = []
  private lastBeatTime = 0

  get connected(): boolean {
    return this.analyser !== null
  }

  async connect(): Promise<void> {
    if (this.connected) return

    // Request system audio via getDisplayMedia (main process auto-approves via setDisplayMediaRequestHandler)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    })

    // Stop video tracks immediately — we only need audio
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
    this.analyser.smoothingTimeConstant = 0.75

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

  /** Call each animation frame to get current audio features */
  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, beat: false, spectrum: [], dominantBand: 0 }
    }

    this.analyser.getByteFrequencyData(this.freqData)
    this.analyser.getByteTimeDomainData(this.timeData)

    const bins = this.freqData.length // 128 bins

    // Frequency band boundaries (approximate for 44.1kHz sample rate)
    // Each bin = sampleRate / fftSize ≈ 172 Hz
    const bassEnd = Math.floor(bins * 0.08)   // ~0-1.4kHz low
    const midEnd = Math.floor(bins * 0.35)    // ~1.4-6kHz mid
    // Rest is treble

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

    // Normalized spectrum (downsample to ~32 bins for visualization)
    const spectrumSize = 32
    const spectrum: number[] = []
    const step = bins / spectrumSize
    for (let i = 0; i < spectrumSize; i++) {
      const start = Math.floor(i * step)
      const end = Math.floor((i + 1) * step)
      let sum = 0
      for (let j = start; j < end; j++) sum += this.freqData[j]
      spectrum.push(sum / ((end - start) * 255))
    }

    // Beat detection: energy spike in bass
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
