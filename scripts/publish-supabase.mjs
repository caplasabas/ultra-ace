#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

function fail(message) {
  console.error(`[publish-supabase] ${message}`)
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
const gameId = process.env.GAME_ID || process.argv[2] || 'ultraace'
const gameDbId = process.env.GAME_DB_ID || gameId

if (!supabaseUrl) fail('SUPABASE_URL is required')
if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is required')
if (!process.env.GAME_PACKAGE_KEY_HEX) fail('GAME_PACKAGE_KEY_HEX is required')

const version = process.env.GAME_VERSION || spawnSync('node', [
  '-p',
  "require('./apps/ultra-ace-web/package.json').version",
], { encoding: 'utf8' }).stdout.trim()

if (!version) fail('Could not resolve game version')

const packageCmd = spawnSync('bash', ['scripts/package-encrypted.sh'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GAME_ID: gameId,
    GAME_VERSION: version,
  },
})
if (packageCmd.status !== 0) fail('package-encrypted failed')

const encPath = path.resolve(`dist-package/encrypted/${gameId}/${version}/${gameId}-${version}.enc`)
if (!fs.existsSync(encPath)) fail(`Encrypted package not found: ${encPath}`)

const objectPath = `${gameId}/${version}/${gameId}-${version}.enc`
const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`
const content = fs.readFileSync(encPath)

const uploadRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/octet-stream',
    'x-upsert': 'true',
  },
  body: content,
})

if (!uploadRes.ok) {
  const body = await uploadRes.text()
  fail(`Storage upload failed (${uploadRes.status}): ${body}`)
}

const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
const gameQueryUrl = `${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(gameDbId)}&select=id,version&limit=1`

const currentRes = await fetch(gameQueryUrl, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
})

if (!currentRes.ok) {
  const body = await currentRes.text()
  fail(`Fetch game row failed (${currentRes.status}): ${body}`)
}

const rows = await currentRes.json()
if (!Array.isArray(rows) || rows.length === 0) {
  fail(`No game row found for id="${gameDbId}"`)
}

const currentVersion = Number(rows[0].version ?? 0)
const nextVersion = Number.isFinite(currentVersion) ? currentVersion + 1 : 1

const updateRes = await fetch(`${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(gameDbId)}`, {
  method: 'PATCH',
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    package_url: publicUrl,
    version: nextVersion,
    updated_at: new Date().toISOString(),
  }),
})

if (!updateRes.ok) {
  const body = await updateRes.text()
  fail(`Update games table failed (${updateRes.status}): ${body}`)
}

console.log(`[publish-supabase] Uploaded: ${publicUrl}`)
console.log(`[publish-supabase] Updated games.id=${gameDbId} version=${nextVersion}`)
