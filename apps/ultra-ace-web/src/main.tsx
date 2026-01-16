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
  import.meta.hot.accept() // 🔴 REQUIRED

  import.meta.hot.on('arcade-input', (payload: any) => {
    console.log('[ARCADE INPUT RAW]', payload)

    // Normalize legacy string payloads
    if (typeof payload === 'string') {
      window.__ARCADE_INPUT__?.({
        type: 'ACTION',
        action: payload,
      })
      return
    }

    // Drop invalid payloads
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
