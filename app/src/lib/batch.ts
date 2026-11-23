import { useSyncExternalStore } from 'react'
import { db } from './db'
import { grammarDetailsBatch, wordDetailsBatch, type BatchQuality } from './llm'
import type { Item } from './types'

export interface BatchState {
  running: boolean
  total: number
  done: number
  failed: number
  error: string
}

const BATCH_SIZE = 5

let state: BatchState = { running: false, total: 0, done: 0, failed: 0, error: '' }
let cancelled = false
const listeners = new Set<() => void>()

function set(patch: Partial<BatchState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useBatch() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function cancelBatch() {
  cancelled = true
}

/** Items that do not have a generated detail yet. */
export async function itemsWithoutDetail(items: Item[]) {
  const rows = await db.details.bulkGet(items.map((i) => i.id))
  return items.filter((_, k) => !rows[k])
}

/**
 * Generates details for many favourites, several per request.
 * Items that already have a detail are skipped, so nothing is paid for twice.
 */
export async function runBatch(items: Item[], quality: BatchQuality) {
  if (state.running) return
  const todo = await itemsWithoutDetail(items)
  cancelled = false
  set({ running: true, total: todo.length, done: 0, failed: 0, error: '' })
  const chunks: Item[][] = []
  for (const type of ['word', 'grammar'] as const) {
    const list = todo.filter((i) => i.type === type)
    for (let k = 0; k < list.length; k += BATCH_SIZE) chunks.push(list.slice(k, k + BATCH_SIZE))
  }
  for (const chunk of chunks) {
    if (cancelled) break
    try {
      const { items: results, model } =
        chunk[0].type === 'word'
          ? await wordDetailsBatch(
              chunk.map((i) => ({ headword: i.headword, reading: i.reading })),
              quality,
            )
          : await grammarDetailsBatch(
              chunk.map((i) => i.headword),
              quality,
            )
      const rows = chunk.flatMap((item, k) => (results[k] ? [{ id: item.id, data: results[k], model, at: Date.now() }] : []))
      await db.details.bulkPut(rows)
      set({ done: state.done + rows.length, failed: state.failed + chunk.length - rows.length })
    } catch (e) {
      set({ failed: state.failed + chunk.length, error: (e as Error).message })
    }
  }
  set({ running: false })
}
