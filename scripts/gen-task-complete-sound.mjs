// Generates a chiptune-style "task complete" jingle as 16-bit PCM WAV.
// 8-bit aesthetic: square wave + ascending arpeggio (C major, C5->E5->G5->C6),
// step-quantized amplitude (bit-crush), short staccato notes, no reverb tail.
// Run: node scripts/gen-task-complete-sound.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, '../src/renderer/assets/sounds/task-complete.wav')

const SAMPLE_RATE = 22050   // lo-fi sample rate, very 8-bit
const BIT_DEPTH_SIM = 5     // simulate 5-bit amplitude resolution (chiptune crunch)

// Ascending C major arpeggio + octave on top — classic "win!" cue
const sequence = [
  { freq: 523.25, dur: 0.075 }, // C5
  { freq: 659.25, dur: 0.075 }, // E5
  { freq: 783.99, dur: 0.075 }, // G5
  { freq: 1046.50, dur: 0.220 }, // C6 (held longer)
]

const TOTAL_DURATION = sequence.reduce((sum, n) => sum + n.dur, 0) + 0.02
const TOTAL = Math.floor(SAMPLE_RATE * TOTAL_DURATION)
const buffer = new Float32Array(TOTAL)

// 50% duty-cycle square wave
function square(t, freq) {
  const phase = (t * freq) % 1
  return phase < 0.5 ? 1 : -1
}

let cursorSec = 0
for (const note of sequence) {
  const startSample = Math.floor(cursorSec * SAMPLE_RATE)
  const noteSamples = Math.floor(note.dur * SAMPLE_RATE)

  // Short attack/release to avoid clicks but stay punchy
  const attackS = Math.floor(0.002 * SAMPLE_RATE)
  const releaseS = Math.floor(0.012 * SAMPLE_RATE)

  for (let i = 0; i < noteSamples; i++) {
    const idx = startSample + i
    if (idx >= TOTAL) break
    const t = i / SAMPLE_RATE

    let env = 1
    if (i < attackS) env = i / attackS
    else if (i > noteSamples - releaseS) env = Math.max(0, (noteSamples - i) / releaseS)

    buffer[idx] = square(t, note.freq) * env * 0.55
  }
  cursorSec += note.dur
}

// Bit-crush: quantize amplitude to BIT_DEPTH_SIM steps for that crunchy NES feel
const steps = Math.pow(2, BIT_DEPTH_SIM)
for (let i = 0; i < TOTAL; i++) {
  buffer[i] = Math.round(buffer[i] * steps) / steps
  if (buffer[i] > 0.95) buffer[i] = 0.95
  else if (buffer[i] < -0.95) buffer[i] = -0.95
}

// Encode 16-bit mono PCM WAV
const dataLength = TOTAL * 2
const wav = Buffer.alloc(44 + dataLength)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + dataLength, 4)
wav.write('WAVE', 8)
wav.write('fmt ', 12)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)               // PCM
wav.writeUInt16LE(1, 22)               // mono
wav.writeUInt32LE(SAMPLE_RATE, 24)
wav.writeUInt32LE(SAMPLE_RATE * 2, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(dataLength, 40)

for (let i = 0; i < TOTAL; i++) {
  const s = Math.max(-1, Math.min(1, buffer[i]))
  wav.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, wav)
console.log(`Wrote ${OUT_PATH} (${wav.length} bytes, ${TOTAL_DURATION.toFixed(3)}s)`)
