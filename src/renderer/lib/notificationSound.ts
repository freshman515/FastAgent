import taskCompleteUrl from '@/assets/sounds/task-complete.wav'

let cached: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!cached) {
    cached = new Audio(taskCompleteUrl)
    cached.preload = 'auto'
  }
  return cached
}

/**
 * Play the task-complete notification sound.
 * Safe to call from any UI event handler — failures (autoplay block, missing
 * audio device) are swallowed so they never break the calling flow.
 */
export function playTaskCompleteSound(volume = 0.6): void {
  try {
    const audio = getAudio()
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    // ignore — sound is best-effort
  }
}
