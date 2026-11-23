import { db } from './db'
import { getSettings } from './settings'
import { isDue, schedule, type Grade } from './srs'
import { grammarKey, katakanaToHiragana } from './text'
import type { CompareGroup, CompareQuiz, Item, Source } from './types'

export type Question =
  | { kind: 'meaning'; item: Item; options: string[]; answer: number }
  | { kind: 'word'; item: Item; options: string[]; answer: number }
  | { kind: 'cloze'; item: Item; before: string; after: string; source: Source; options: string[]; answer: number }
  | { kind: 'spell'; item: Item; source?: { before: string; after: string; translation?: string } }
  | { kind: 'write'; item: Item }
  | { kind: 'flash'; item: Item }
  | { kind: 'compare'; group: CompareGroup; quiz: CompareQuiz; options: string[]; answer: number }

export const QUESTION_LABEL: Record<Question['kind'], string> = {
  meaning: '选择意思',
  word: '选择单词',
  cloze: '原文填空',
  spell: '拼写',
  write: '造句',
  flash: '回忆',
  compare: '相似词辨析',
}

const shuffle = <T>(a: T[]) => {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]

function choices(correct: string, pool: string[], n = 4) {
  const others = shuffle([...new Set(pool.filter((x) => x && x !== correct))]).slice(0, n - 1)
  const options = shuffle([correct, ...others])
  return { options, answer: options.indexOf(correct) }
}

/** Splits a source sentence around the favourite (word surface or grammar core). */
function blankIn(item: Item, s: Source) {
  const needle = item.type === 'word' ? s.surface || item.headword : grammarKey(item.headword).split('/')[0]
  if (!needle || s.lang !== 'ja') return null
  const i = s.text.indexOf(needle)
  if (i < 0) return null
  return { before: s.text.slice(0, i), after: s.text.slice(i + needle.length) }
}

export function makeQuestion(item: Item, all: Item[], opts: { preferEasy?: boolean } = {}): Question {
  const settings = getSettings()
  const pool = all.filter((i) => i.type === item.type && i.id !== item.id)
  const kinds: Question['kind'][] = []
  const enough = pool.length >= 2
  if (enough) kinds.push('meaning', 'word')
  const src = item.sources.find((s) => blankIn(item, s))
  if (enough && src) kinds.push('cloze')
  if (item.type === 'word' && !opts.preferEasy) kinds.push('spell')
  const reps = item.srs?.reps ?? 0
  if (settings.reviewWriting && settings.apiKey && reps >= 1 && !opts.preferEasy && Math.random() < 0.35) kinds.push('write')
  if (!kinds.length || opts.preferEasy) kinds.push('flash')
  const kind = opts.preferEasy && enough ? pick(['meaning', 'flash'] as const) : pick(kinds)

  switch (kind) {
    case 'meaning': {
      const c = choices(item.meaning, pool.map((i) => i.meaning))
      return { kind, item, ...c }
    }
    case 'word': {
      const c = choices(item.headword, pool.map((i) => i.headword))
      return { kind, item, ...c }
    }
    case 'cloze': {
      const b = blankIn(item, src!)!
      const c = choices(item.headword, pool.map((i) => i.headword))
      return { kind, item, ...b, source: src!, ...c }
    }
    case 'spell': {
      const s = item.sources.map((x) => ({ x, b: blankIn(item, x) })).find((v) => v.b)
      return { kind, item, source: s ? { ...s.b!, translation: s.x.translation } : undefined }
    }
    default:
      return { kind, item } as Question
  }
}

export function compareQuestion(group: CompareGroup, quiz?: CompareQuiz): Question | null {
  const q = quiz ?? (group.quiz.length ? pick(group.quiz) : null)
  if (!q) return null
  const options = shuffle(group.words.map((w) => w.word))
  return { kind: 'compare', group, quiz: q, options, answer: options.indexOf(q.answer) }
}

export function checkSpelling(item: Item, input: string) {
  const norm = (s: string) => katakanaToHiragana(s.replace(/[\s　]/g, ''))
  const v = norm(input)
  return !!v && (v === norm(item.headword) || (!!item.reading && v === norm(item.reading)))
}

// ---------- session building ----------

const todayKey = () => `jr-new-${new Date().toISOString().slice(0, 10)}`

function newIntroducedToday() {
  try {
    return Number(localStorage.getItem(todayKey()) ?? 0)
  } catch {
    return 0
  }
}

function markNewIntroduced() {
  try {
    localStorage.setItem(todayKey(), String(newIntroducedToday() + 1))
  } catch {
    /* ignore */
  }
}

export interface Card {
  target: { type: 'item'; id: string } | { type: 'group'; id: string }
  question: Question
  isNew: boolean
}

export async function reviewCounts() {
  const [items, groups] = await Promise.all([db.items.toArray(), db.groups.toArray()])
  const now = Date.now()
  const newLeft = Math.max(0, getSettings().newPerDay - newIntroducedToday())
  return {
    dueWords: items.filter((i) => i.type === 'word' && isDue(i.srs, now)).length,
    dueGrammar: items.filter((i) => i.type === 'grammar' && isDue(i.srs, now)).length,
    newItems: Math.min(newLeft, items.filter((i) => !i.srs).length),
    dueGroups: groups.filter((g) => g.quiz.length && (!g.srs || isDue(g.srs, now))).length,
    totalGroups: groups.length,
  }
}

export type SessionMode = { kind: 'daily' } | { kind: 'compare' } | { kind: 'group'; id: string }

export async function buildSession(mode: SessionMode, limit = 30): Promise<Card[]> {
  const [items, groups] = await Promise.all([db.items.toArray(), db.groups.toArray()])
  const now = Date.now()
  if (mode.kind === 'group') {
    const g = groups.find((x) => x.id === mode.id)
    if (!g) return []
    return shuffle(g.quiz).flatMap((q) => {
      const question = compareQuestion(g, q)
      return question ? [{ target: { type: 'group' as const, id: g.id }, question, isNew: false }] : []
    })
  }
  const cards: Card[] = []
  const dueGroups = groups.filter((g) => g.quiz.length && (!g.srs || isDue(g.srs, now)))
  for (const g of shuffle(dueGroups)) {
    const question = compareQuestion(g)
    if (question) cards.push({ target: { type: 'group', id: g.id }, question, isNew: !g.srs })
  }
  if (mode.kind === 'daily') {
    const due = items.filter((i) => isDue(i.srs, now)).sort((a, b) => a.srs!.due - b.srs!.due)
    const newLeft = Math.max(0, getSettings().newPerDay - newIntroducedToday())
    const fresh = items
      .filter((i) => !i.srs)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, newLeft)
    for (const i of due) cards.push({ target: { type: 'item', id: i.id }, question: makeQuestion(i, items), isNew: false })
    for (const i of fresh) cards.push({ target: { type: 'item', id: i.id }, question: makeQuestion(i, items, { preferEasy: true }), isNew: true })
  }
  return shuffle(cards).slice(0, limit)
}

/** A different question for a card answered wrongly, to be asked again later in the session. */
export async function retryCard(card: Card): Promise<Card> {
  if (card.question.kind === 'compare') {
    const g = card.question.group
    const others = g.quiz.filter((q) => q !== (card.question as { quiz: CompareQuiz }).quiz)
    return { ...card, question: compareQuestion(g, others.length ? pick(others) : undefined) ?? card.question }
  }
  const q = card.question
  const items = await db.items.toArray()
  const item = items.find((i) => i.id === q.item.id) ?? q.item
  return { ...card, question: makeQuestion(item, items, { preferEasy: true }) }
}

export async function applyGrade(card: Card, grade: Grade) {
  if (card.target.type === 'item') {
    const item = await db.items.get(card.target.id)
    if (!item) return
    if (!item.srs) markNewIntroduced()
    await db.items.update(item.id, { srs: schedule(item.srs, grade) })
  } else {
    const g = await db.groups.get(card.target.id)
    if (!g) return
    await db.groups.update(g.id, { srs: schedule(g.srs, grade) })
  }
}
