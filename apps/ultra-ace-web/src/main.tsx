declare global {
  interface Window {
    __ARCADE_INPUT__?: (payload: any) => void
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import './index.css'
import './App.css'

if (import.meta.hot) {
  import.meta.hot.accept()

  import.meta.hot.on('arcade-input', (raw: any) => {
    console.log('[ARCADE INPUT RAW]', raw)

    let payload: any

    // 🔴 CRITICAL FIX: decode stringified payload
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch (err) {
      console.warn('[ARCADE INPUT] Failed to parse payload:', raw)
      return
    }

    // Legacy support (old string-only actions)
    if (typeof payload === 'string') {
      window.__ARCADE_INPUT__?.({
        type: 'ACTION',
        action: payload,
      })
      return
    }

    // Defensive validation
    if (!payload || typeof payload !== 'object') {
      console.warn('[ARCADE INPUT] Invalid payload:', payload)
      return
    }

    window.__ARCADE_INPUT__?.(payload)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
