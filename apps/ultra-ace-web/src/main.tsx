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

    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      console.warn('[ARCADE INPUT] Invalid JSON:', raw)
      return
    }

    // ✅ NORMALIZATION LAYER (CRITICAL)
    if (
      payload?.type &&
      payload.type !== 'ACTION' &&
      payload.type !== 'COIN' &&
      payload.type !== 'WITHDRAW_DISPENSE' &&
      payload.type !== 'WITHDRAW_COMPLETE'
    ) {
      payload = {
        type: 'ACTION',
        action: payload.type,
      }
    }

    window.__ARCADE_INPUT__?.(payload)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
