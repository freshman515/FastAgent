import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

function normalizeIconSource(icon: string): string {
  const trimmed = icon.trim()
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, '/')}`
  }
  return trimmed
}

export function isImageIcon(icon: string | undefined): boolean {
  if (!icon) return false
  const trimmed = icon.trim()
  return /^(https?:|data:image\/|file:|\/|[A-Za-z]:[\\/])/.test(trimmed)
    || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(trimmed)
}

export function SessionIconView({
  icon,
  fallbackSrc,
  className,
  imageClassName,
}: {
  icon?: string
  fallbackSrc?: string
  className?: string
  imageClassName?: string
}): JSX.Element {
  const resolvedIcon = icon?.trim()
  const src = resolvedIcon && isImageIcon(resolvedIcon)
    ? normalizeIconSource(resolvedIcon)
    : fallbackSrc
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(src) && !imageFailed

  useEffect(() => {
    setImageFailed(false)
  }, [src])

  return (
    <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center', className)}>
      {showImage ? (
        <img
          src={src}
          alt=""
          className={cn('h-4.5 w-4.5 shrink-0', imageClassName)}
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={cn('text-[15px] leading-none', imageClassName)}>
          {resolvedIcon && !isImageIcon(resolvedIcon) ? resolvedIcon : '⚙'}
        </span>
      )}
    </div>
  )
}
