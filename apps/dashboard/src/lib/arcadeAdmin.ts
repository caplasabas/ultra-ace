const ADMIN_BASE = (import.meta.env.VITE_ARCADE_ADMIN_API_BASE || '').replace(/\/+$/, '')

function canUseAdminApi() {
  return Boolean(ADMIN_BASE)
}

async function post(path: string, body: Record<string, any>) {
  if (!canUseAdminApi()) return { ok: true, skipped: true as const }

  const res = await fetch(`${ADMIN_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: new Error(text || `HTTP ${res.status}`) }
  }

  return { ok: true }
}

export async function removeGamePackage(gameId: string, version?: number, allVersions = false) {
  return post('/game-package/remove', {
    id: gameId,
    version: version ?? 1,
    allVersions,
  })
}

export async function purgeGamePackages() {
  return post('/game-package/purge', {})
}

export async function prepareGamePackage(gameId: string, packageUrl: string, version?: number) {
  if (!packageUrl) return { ok: true, skipped: true as const }
  return post('/game-package/prepare', {
    id: gameId,
    packageUrl,
    version: version ?? 1,
  })
}
