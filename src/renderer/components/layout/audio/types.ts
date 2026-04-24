// ─── Visualizer Mode ───

export type VisualizerMode = 'melody' | 'bars'

// ─── Audio Analysis Output ───

export interface AudioFeatures {
  /** Overall loudness 0-1 */
  volume: number
  /** Low frequency energy 0-1 (20-250 Hz) */
  bass: number
  /** Mid frequency energy 0-1 (250-4000 Hz) */
  mid: number
  /** High frequency energy 0-1 (4000-20000 Hz) */
  treble: number
  /** Beat detected this frame */
  beat: boolean
  /** Raw frequency bins (normalized 0-1) */
  spectrum: number[]
  /** Dominant frequency band index */
  dominantBand: number
}

// ─── Visual Parameters ───

export interface VisualParams {
  /** Curve wave amplitude multiplier */
  amplitude: number
  /** Horizontal flow speed */
  flowSpeed: number
  /** Base hue (0-360) */
  hue: number
  /** Base saturation 0-1 */
  saturation: number
  /** Base lightness 0-1 */
  lightness: number
  /** Glow intensity 0-1 */
  glowIntensity: number
  /** Whether to burst particles this frame */
  particleBurst: boolean
  /** Bass impact for pulse effects 0-1 */
  bassImpact: number
  /** Treble shimmer for sparkle effects 0-1 */
  trebleShimmer: number
  /** Curve thickness */
  lineWidth: number
}

// ─── Particle ───

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
}
