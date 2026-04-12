import { useEffect, useState } from 'react'
import type { DashboardProfile, DashboardRole } from '../hooks/useDashboardAuth'
import { supabase } from '../lib/supabase'

const ROLE_OPTIONS: DashboardRole[] = ['superadmin', 'admin', 'staff', 'runner', 'accounts']

type Props = {
  viewerRole: DashboardRole
}

export default function Accounts({ viewerRole }: Props) {
  const [rows, setRows] = useState<DashboardProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('dashboard_users')
      .select('user_id,email,full_name,role,is_active')
      .order('email')

    setLoading(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setRows((data ?? []) as DashboardProfile[])
  }

  async function updateRow(userId: string, patch: Partial<DashboardProfile>) {
    setSavingUserId(userId)
    setMessage(null)
    setErrorMessage(null)

    const { error } = await supabase.from('dashboard_users').update(patch).eq('user_id', userId)

    setSavingUserId(null)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setMessage('Account updated')
    await load()
  }

  const canManageRoles = viewerRole === 'superadmin' || viewerRole === 'admin' || viewerRole === 'accounts'

  return (
    <div className="p-6 max-w-[90rem] mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-slate-400">
          Dashboard access uses Supabase Auth. This page manages dashboard roles only.
        </p>
      </header>

      {message && (
        <div className="rounded border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {errorMessage}
        </div>
      )}

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300 space-y-2">
        <div>Roles: `superadmin`, `admin`, `staff`, `runner`, `accounts`</div>
        <div>
          Create Auth users in Supabase Auth first, then insert/update their row in `dashboard_users`.
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold">
          Dashboard Users
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {rows.map(row => (
                <tr key={row.user_id}>
                  <td className="px-4 py-2">{row.email}</td>
                  <td className="px-4 py-2">{row.full_name || '-'}</td>
                  <td className="px-4 py-2">
                    <select
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
                      value={row.role}
                      disabled={!canManageRoles || savingUserId === row.user_id}
                      onChange={e =>
                        void updateRow(row.user_id, { role: e.target.value as DashboardRole })
                      }
                    >
                      {ROLE_OPTIONS.map(role => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded px-2 py-1 text-xs font-medium ${row.is_active ? 'bg-emerald-950/40 text-emerald-300' : 'bg-red-950/40 text-red-300'}`}
                    >
                      {row.is_active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="rounded border border-slate-600 bg-slate-900 px-3 py-1 text-xs text-slate-100 disabled:opacity-50"
                      disabled={!canManageRoles || savingUserId === row.user_id}
                      onClick={() => void updateRow(row.user_id, { is_active: !row.is_active })}
                    >
                      {savingUserId === row.user_id
                        ? 'Saving...'
                        : row.is_active
                          ? 'Disable'
                          : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No dashboard users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
