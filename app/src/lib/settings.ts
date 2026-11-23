import { useSyncExternalStore } from 'react'

export interface Settings {
  baseUrl: string
  apiKey: string
  /** Fast, cheap model used for sentence analysis. */
  model: string
  /** Used when the main model fails. */
  fallbackModel: string
  /** Higher quality model for word / grammar detail pages. */
  deepModel: string
  /** Show grammar of this JLPT level and harder (1 = N1 only … 5 = everything). */
  minGrammarLevel: number
  furigana: boolean
  fontSize: number
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.quickrouter.ai/v1',
  apiKey: '',
  model: 'gemini-3.1-flash-lite',
  fallbackModel: 'glm-5.3-flash',
  deepModel: 'gemini-3.5-flash',
  minGrammarLevel: 3,
  furigana: false,
  fontSize: 19,
}

const STORAGE_KEY = 'jr-settings'
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS }
}

let current = load()

export function getSettings() {
  return current
}

export function saveSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l())
}

export function useSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
