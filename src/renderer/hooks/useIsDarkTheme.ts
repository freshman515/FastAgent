import { useEffect, useState } from 'react'

/**
 * Returns true when the current UI theme is dark (root has `theme-dark` class).
 * Reactively updates when the theme changes.
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('theme-dark'),
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('theme-dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}
