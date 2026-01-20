import { initEngine, updateEngineConfig } from './engineContext.js'
import type { EngineConfig } from './engineConfig.js'

export function startEngine(payload: { config: EngineConfig; version: string }) {
  initEngine(payload.config, payload.version)
}

export function hotUpdateEngine(payload: { config: EngineConfig; version: string }) {
  updateEngineConfig(payload.config, payload.version)
}
