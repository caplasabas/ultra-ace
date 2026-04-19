import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type DashboardRole = 'superadmin' | 'admin' | 'staff' | 'runner' | 'accounts'

export type DashboardProfile = {
  user_id: string
  email: string
  full_name: string | null
  role: DashboardRole
  is_active: boolean
}

export function useDashboardAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<DashboardProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function loadProfile(nextSession: Session | null, showLoading = false) {
      if (!mounted) return
      if (showLoading) {
        setLoading(true)
      }
      setSession(nextSession)

      if (!nextSession?.user?.id) {
        setProfile(null)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('dashboard_users')
        .select('user_id,email,full_name,role,is_active')
        .eq('user_id', nextSession.user.id)
        .maybeSingle()

      if (!mounted) return

      if (error) {
        setProfile(null)
      } else {
        setProfile((data ?? null) as DashboardProfile | null)
      }

      setLoading(false)
    }

    void supabase.auth.getSession().then(({ data }) => {
      void loadProfile(data.session, true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadProfile(nextSession)
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  return {
    loading,
    session,
    profile,
    isSignedIn: Boolean(session),
    isActive: Boolean(profile?.is_active),
  }
}
