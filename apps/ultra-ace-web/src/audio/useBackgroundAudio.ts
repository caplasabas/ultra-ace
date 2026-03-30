import { useEffect, useRef } from 'react'

export function useBackgroundAudio(src: string, enabled: boolean, volume = 0.5) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const current = audioRef.current
    if (!current || current.src !== new URL(src, window.location.href).href) {
      current?.pause()
      audioRef.current = new Audio(src)
      audioRef.current.loop = true
      audioRef.current.preload = 'auto'
    }
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
  }, [volume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let disposed = false

    const attemptPlay = () => {
      if (disposed || !enabled) return
      void audio.play().catch(() => {
        // Autoplay can be blocked until the first user gesture.
      })
    }

    if (enabled) {
      attemptPlay()
      window.addEventListener('pointerdown', attemptPlay)
      window.addEventListener('keydown', attemptPlay)
    } else {
      audio.pause()
    }

    return () => {
      disposed = true
      window.removeEventListener('pointerdown', attemptPlay)
      window.removeEventListener('keydown', attemptPlay)
      audio.pause()
    }
  }, [enabled])
}
