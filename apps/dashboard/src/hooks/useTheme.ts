import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'arcade_theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light') // ✅ DEFAULT LIGHT

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
    const initial = saved === 'dark' ? 'dark' : 'light'
    setTheme(initial)
    if (initial === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
    // no-op: Tailwind uses `dark` class only
  }, [theme])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  function toggleTheme() {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  return { theme, toggleTheme }
}
