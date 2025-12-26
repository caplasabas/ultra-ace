import { useEffect, useRef } from 'react'

export function useBackgroundAudio(src: string, enabled: boolean, volume = 0.5) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(src)
      audioRef.current.loop = true
      audioRef.current.volume = volume
    }

    const audio = audioRef.current

    if (enabled) {
      audio.play().catch(() => {
        // autoplay blocked — user interaction required
      })
    } else {
      audio.pause()
    }

    return () => {
      audio.pause()
    }
  }, [enabled, src, volume])
}
