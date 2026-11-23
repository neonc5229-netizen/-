import { useSyncExternalStore } from 'react'
import { db } from './db'
import { compareGroups, type BatchQuality, type RawGroup } from './llm'
import { katakanaToHiragana } from './text'
import type { CompareGroup, Item } from './types'

const groupId = (words: string[]) => [...words].sort().join('・')

function toGroup(raw: RawGroup, model: string): CompareGroup | null {
  const seen = new Set<string>()
  const words = (raw.words ?? []).filter((w) => w?.word && !seen.has(w.word) && seen.add(w.word))
  if (words.length < 2) return null
  const names = new Set(words.map((w) => w.word))
  const quiz = (raw.quiz ?? []).filter((q) => q?.sentence?.includes('＿') && names.has(q.answer))
  return {
    id: groupId(words.map((w) => w.word)),
    theme: raw.theme ?? '',
    kind: raw.kind ?? '',
    words: words.map((w) => ({
      word: w.word,
      reading: katakanaToHiragana(w.reading ?? ''),
      meaning: w.meaning ?? '',
      nuance: w.nuance ?? '',
      example: { ja: w.example_ja ?? '', zh: w.example_zh ?? '' },
    })),
    keyPoints: raw.key_points ?? '',
    quiz,
    model,
    createdAt: Date.now(),
  }
}

/** Groups containing a word. */
export async function groupsFor(headword: string) {
  const all = await db.groups.toArray()
  return all.filter((g) => g.words.some((w) => w.word === headword))
}

async function saveGroups(raws: RawGroup[], model: string) {
  const groups = raws.map((r) => toGroup(r, model)).filter((g): g is CompareGroup => !!g)
  await db.transaction('rw', db.groups, async () => {
    for (const g of groups) {
      const existing = await db.groups.get(g.id)
      await db.groups.put(existing ? { ...g, srs: existing.srs, createdAt: existing.createdAt } : g)
    }
  })
  return groups
}

export async function generateGroupFor(item: Pick<Item, 'headword' | 'meaning'>, quality: BatchQuality = 'deep') {
  const { groups, model } = await compareGroups([{ headword: item.headword, meaning: item.meaning }], quality)
  return saveGroups(groups, model)
}

// ---------- batch generation for favourites ----------

export interface CompareBatchState {
  running: boolean
  total: number
  done: number
  failed: number
  error: string
}

let state: CompareBatchState = { running: false, total: 0, done: 0, failed: 0, error: '' }
let cancelled = false
const listeners = new Set<() => void>()
const set = (p: Partial<CompareBatchState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function useCompareBatch() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function cancelCompareBatch() {
  cancelled = true
}

/** Favourite words that are not in any comparison group yet. */
export async function wordsWithoutGroup() {
  const [items, groups] = await Promise.all([db.items.where('type').equals('word').toArray(), db.groups.toArray()])
  const covered = new Set(groups.flatMap((g) => g.words.map((w) => w.word)))
  return items.filter((i) => !covered.has(i.headword))
}

const PER_REQUEST = 3

export async function runCompareBatch(quality: BatchQuality) {
  if (state.running) return
  cancelled = false
  let todo = await wordsWithoutGroup()
  set({ running: true, total: todo.length, done: 0, failed: 0, error: '' })
  while (todo.length && !cancelled) {
    const chunk = todo.slice(0, PER_REQUEST)
    try {
      const { groups, model } = await compareGroups(
        chunk.map((i) => ({ headword: i.headword, meaning: i.meaning })),
        quality,
      )
      const saved = await saveGroups(groups, model)
      const covered = new Set(saved.flatMap((g) => g.words.map((w) => w.word)))
      const handled = chunk.filter((i) => covered.has(i.headword)).length
      set({ done: state.done + handled, failed: state.failed + chunk.length - handled })
      // A group may also cover other favourites further down the list.
      todo = todo.slice(PER_REQUEST).filter((i) => !covered.has(i.headword))
      set({ total: state.done + state.failed + todo.length })
    } catch (e) {
      set({ failed: state.failed + chunk.length, error: (e as Error).message })
      todo = todo.slice(PER_REQUEST)
    }
  }
  set({ running: false })
}
