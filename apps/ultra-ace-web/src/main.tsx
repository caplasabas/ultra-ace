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
    console.log('[ARCADE INPUT]', payload)
    window.__ARCADE_INPUT__?.(payload)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
