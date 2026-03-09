#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { spawnSync } from 'child_process'

function fail(message) {
  console.error(`[encrypt-package] ${message}`)
  process.exit(1)
}

const gameId = process.env.GAME_ID || process.argv[2] || 'ultraace'
const version = process.env.GAME_VERSION || process.argv[3]
if (!version) fail('Missing version. Pass as arg or GAME_VERSION env.')

const keyHex = process.env.GAME_PACKAGE_KEY_HEX
if (!keyHex || keyHex.length !== 64) {
  fail('GAME_PACKAGE_KEY_HEX must be a 64-char hex string (32-byte AES key).')
}

const key = Buffer.from(keyHex, 'hex')
const packageDir = path.resolve(`dist-package/${gameId}-${version}`)
if (!fs.existsSync(packageDir)) fail(`Package dir not found: ${packageDir}`)

const outDir = path.resolve(`dist-package/encrypted/${gameId}/${version}`)
fs.mkdirSync(outDir, { recursive: true })

const tarPath = path.join(outDir, `${gameId}-${version}.tar.gz`)
const encPath = path.join(outDir, `${gameId}-${version}.enc`)
const manifestPath = path.join(outDir, 'manifest.enc.json')

const tar = spawnSync('tar', ['-czf', tarPath, '-C', packageDir, '.'], { stdio: 'inherit' })
if (tar.status !== 0) fail('tar compression failed')

const plain = fs.readFileSync(tarPath)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
const tag = cipher.getAuthTag()
const payload = Buffer.concat([iv, tag, encrypted])

fs.writeFileSync(encPath, payload)

const manifest = {
  format: 'arcade-encrypted-v1',
  cipher: 'aes-256-gcm',
  ivLength: 12,
  tagLength: 16,
  gameId,
  version,
  entry: 'index.html',
  plaintext: {
    file: path.basename(tarPath),
    bytes: plain.length,
    sha256: createHash('sha256').update(plain).digest('hex'),
  },
  encrypted: {
    file: path.basename(encPath),
    bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
  },
  generatedAt: new Date().toISOString(),
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
fs.rmSync(tarPath)

console.log(`[encrypt-package] wrote ${encPath}`)
console.log(`[encrypt-package] wrote ${manifestPath}`)
