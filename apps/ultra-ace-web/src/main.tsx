declare global {
  interface Window {
    __ARCADE_INPUT__?: (action: string) => void
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'

import './index.css'

import App from './App'

import './App.css'

if (import.meta.hot) {
  import.meta.hot.on('arcade-input', (action: string) => {
    console.log('[ARCADE INPUT]', action)
    window.__ARCADE_INPUT__?.(action)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
