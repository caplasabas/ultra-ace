import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Accounting from './pages/Accounting'
import Accounts from './pages/Accounts'
import { useDashboardAuth, type DashboardRole } from './hooks/useDashboardAuth'
import { supabase } from './lib/supabase'

type Page = 'dashboard' | 'settings' | 'accounting' | 'accounts'

function SignInScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setErrorMessage(null)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setBusy(false)

    if (error) {
      setErrorMessage(error.message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5 shadow-2xl">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Ultra Ace Dashboard</h1>
          <p className="text-sm text-slate-400">Sign in with your dashboard account.</p>
        </div>

        {errorMessage && (
          <div className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-sm text-slate-300">Email</span>
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-slate-300">Password</span>
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void signIn()
            }}
          />
        </label>

        <button
          className="w-full rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
          disabled={busy || !email.trim() || !password}
          onClick={() => void signIn()}
        >
          {busy ? 'Signing In...' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

function AccessPendingScreen() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Dashboard Access Pending</h1>
        <p className="text-sm text-slate-400">
          Your Auth account exists, but there is no active `dashboard_users` role assigned yet.
        </p>
        <button
          className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-100"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

function canAccess(page: Page, role: DashboardRole) {
  if (page === 'dashboard') return true
  if (page === 'accounting') return role !== 'runner' && role !== 'staff'
  if (page === 'settings') return role === 'superadmin' || role === 'admin'
  if (page === 'accounts') {
    return role === 'superadmin' || role === 'admin' || role === 'accounts'
  }
  return false
}

function App() {
  const { loading, isSignedIn, isActive, profile } = useDashboardAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordBusy, setChangePasswordBusy] = useState(false)
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null)

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">Loading...</div>
  }

  if (!isSignedIn) {
    return <SignInScreen />
  }

  if (!profile || !isActive) {
    return <AccessPendingScreen />
  }

  const availablePages: Page[] = ['dashboard', 'accounting', 'settings', 'accounts'].filter(p =>
    canAccess(p as Page, profile.role),
  ) as Page[]

  const currentPage = canAccess(page, profile.role) ? page : availablePages[0]

  async function changeOwnPassword() {
    setChangePasswordError(null)

    if (!profile?.email) {
      setChangePasswordError('Missing account email')
      return
    }

    if (currentPassword.length === 0) {
      setChangePasswordError('Current password is required')
      return
    }

    if (newPassword.length < 6) {
      setChangePasswordError('New password must be at least 6 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError('New passwords do not match')
      return
    }

    if (newPassword === currentPassword) {
      setChangePasswordError('New password must be different')
      return
    }

    setChangePasswordBusy(true)

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    })

    if (verifyError) {
      setChangePasswordBusy(false)
      setChangePasswordError('Current password is incorrect')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setChangePasswordBusy(false)
      setChangePasswordError(updateError.message)
      return
    }

    setChangePasswordOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setChangePasswordBusy(false)
    await supabase.auth.signOut({ scope: 'global' })
  }

  return (
    <div className="min-h-full bg-slate-900 text-slate-100">
      <nav className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="max-w-[90rem] mx-auto px-3 sm:px-6 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Ultra Ace Dashboard</div>
              <div className="text-xs text-slate-400">
                {profile.email} • {profile.role}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-100"
                onClick={() => {
                  setChangePasswordError(null)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                  setChangePasswordOpen(true)
                }}
              >
                Change Password
              </button>
              <button
                className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-100"
                onClick={() => void supabase.auth.signOut()}
              >
                Sign Out
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {availablePages.includes('dashboard') && (
              <button
                onClick={() => setPage('dashboard')}
                className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                  currentPage === 'dashboard'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900 text-slate-100 border-slate-700'
                }`}
              >
                Dashboard
              </button>
            )}

            {availablePages.includes('accounting') && (
              <button
                onClick={() => setPage('accounting')}
                className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                  currentPage === 'accounting'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900 text-slate-100 border-slate-700'
                }`}
              >
                Accounting
              </button>
            )}

            {availablePages.includes('settings') && (
              <button
                onClick={() => setPage('settings')}
                className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                  currentPage === 'settings'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900 text-slate-100 border-slate-700'
                }`}
              >
                Settings
              </button>
            )}

            {availablePages.includes('accounts') && (
              <button
                onClick={() => setPage('accounts')}
                className={`px-3 py-1 rounded text-sm border whitespace-nowrap ${
                  currentPage === 'accounts'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900 text-slate-100 border-slate-700'
                }`}
              >
                Accounts
              </button>
            )}
          </div>
        </div>
      </nav>

      {currentPage === 'dashboard' ? <Dashboard role={profile.role} /> : null}
      {currentPage === 'settings' ? <Settings /> : null}
      {currentPage === 'accounting' ? <Accounting /> : null}
      {currentPage === 'accounts' ? (
        <Accounts viewerRole={profile.role} currentUserId={profile.user_id} />
      ) : null}

      {changePasswordOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Change Password</h2>
              <p className="text-sm text-slate-400">
                After the password changes, this account will be signed out.
              </p>
            </div>

            {changePasswordError && (
              <div className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {changePasswordError}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-sm text-slate-300">Current Password</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-slate-300">New Password</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-slate-300">Confirm New Password</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void changeOwnPassword()
                }}
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              <button
                className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200"
                disabled={changePasswordBusy}
                onClick={() => {
                  setChangePasswordOpen(false)
                  setChangePasswordError(null)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
              >
                Cancel
              </button>
              <button
                className="rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                disabled={
                  changePasswordBusy || !currentPassword || !newPassword || !confirmPassword
                }
                onClick={() => void changeOwnPassword()}
              >
                {changePasswordBusy ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
