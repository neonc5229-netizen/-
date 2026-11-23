import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db } from './db'
import { analyzeSentences, LlmError } from './llm'
import type { Analysis, Lang } from './types'

export const analysisKey = (lang: Lang, text: string) => `${lang}|${text}`

type Status = 'pending' | 'error'
const status = new Map<string, Status>()
const errors = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version++
  listeners.forEach((l) => l())
}

export function useAnalysisStatus() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return {
    isPending: (key: string) => status.get(key) === 'pending',
    errorOf: (key: string) => (status.get(key) === 'error' ? errors.get(key) : undefined),
  }
}

export function getAnalysisError(key: string) {
  return status.get(key) === 'error' ? errors.get(key) : undefined
}

interface Job {
  lang: Lang
  sentences: string[]
}

const queue: Job[] = []
let running = 0
const CONCURRENCY = 2

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!
    running++
    runJob(job).finally(() => {
      running--
      pump()
    })
  }
}

async function runJob({ lang, sentences }: Job) {
  const keys = sentences.map((s) => analysisKey(lang, s))
  try {
    const { result, model } = await analyzeSentences(lang, sentences)
    const rows: Analysis[] = []
    result.forEach((r, i) => {
      if (r) rows.push({ key: keys[i], lang, text: sentences[i], ...r, model, at: Date.now() })
    })
    await db.analyses.bulkPut(rows)
    keys.forEach((k, i) => {
      if (result[i]) status.delete(k)
      else {
        status.set(k, 'error')
        errors.set(k, '模型没有返回这句话的分析')
      }
    })
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : String(e)
    keys.forEach((k) => {
      status.set(k, 'error')
      errors.set(k, msg)
    })
  }
  notify()
}

/**
 * Queues analysis for sentences that have not been analysed yet.
 * `urgent` puts them at the front of the queue (e.g. the sentence the user just tapped).
 */
export async function ensureAnalyzed(lang: Lang, sentences: string[], opts: { urgent?: boolean; retry?: boolean } = {}) {
  const unique = [...new Set(sentences.filter((s) => s.trim()))]
  const keys = unique.map((s) => analysisKey(lang, s))
  const existing = await db.analyses.bulkGet(keys)
  const todo = unique.filter((_, i) => {
    if (existing[i]) return false
    const st = status.get(keys[i])
    if (st === 'pending') return false
    if (st === 'error' && !opts.retry) return false
    return true
  })
  if (!todo.length) return
  todo.forEach((s) => status.set(analysisKey(lang, s), 'pending'))
  notify()
  // Batch by size so each request stays small and fast.
  const batches: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const s of todo) {
    if (cur.length && (cur.length >= 8 || len + s.length > 500)) {
      batches.push(cur)
      cur = []
      len = 0
    }
    cur.push(s)
    len += s.length
  }
  if (cur.length) batches.push(cur)
  const jobs = batches.map((b) => ({ lang, sentences: b }))
  if (opts.urgent) queue.unshift(...jobs)
  else queue.push(...jobs)
  pump()
}

export function useAnalyses(lang: Lang | undefined, sentences: string[]) {
  const keyStr = lang ? sentences.map((s) => analysisKey(lang, s)).join('\n') : ''
  return useLiveQuery(
    async () => {
      if (!keyStr) return new Map<string, Analysis>()
      const keys = keyStr.split('\n')
      const rows = await db.analyses.bulkGet(keys)
      const m = new Map<string, Analysis>()
      rows.forEach((r) => r && m.set(r.key, r))
      return m
    },
    [keyStr],
    new Map<string, Analysis>(),
  )
}

export async function reanalyze(lang: Lang, sentence: string) {
  const key = analysisKey(lang, sentence)
  await db.analyses.delete(key)
  status.delete(key)
  await ensureAnalyzed(lang, [sentence], { urgent: true, retry: true })
}
