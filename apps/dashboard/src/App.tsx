import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Accounting from './pages/Accounting'

type Page = 'dashboard' | 'settings' | 'accounting'

function App() {
  const [page, setPage] = useState<Page>('dashboard')

  return (
    <div className="min-h-full">
      <nav className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setPage('dashboard')}
              className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                page === 'dashboard'
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setPage('settings')}
              className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                page === 'settings'
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              Settings
            </button>
            <button
              onClick={() => setPage('accounting')}
              className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                page === 'accounting'
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              Accounting
            </button>
          </div>
        </div>
      </nav>

      {page === 'dashboard' ? <Dashboard /> : page === 'settings' ? <Settings /> : <Accounting />}
    </div>
  )
}

export default App
