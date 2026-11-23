import type { IpadicFeatures, Tokenizer } from 'kuromoji'
import { hasKanji, katakanaToHiragana } from './text'
import type { Lang, WordInfo } from './types'

declare global {
  interface Window {
    kuromoji?: { builder(opts: { dicPath: string }): { build(cb: (err: Error | null, t: Tokenizer<IpadicFeatures>) => void): void } }
  }
}

let tokenizer: Tokenizer<IpadicFeatures> | null = null
let loading: Promise<Tokenizer<IpadicFeatures>> | null = null

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('分词器加载失败'))
    document.head.appendChild(el)
  })
}

export function getTokenizer() {
  return tokenizer
}

export function loadTokenizer() {
  if (tokenizer) return Promise.resolve(tokenizer)
  if (!loading) {
    const base = `${import.meta.env.BASE_URL}kuromoji/`
    loading = (async () => {
      if (!window.kuromoji) await loadScript(`${base}kuromoji.js`)
      return new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
        window.kuromoji!.builder({ dicPath: `${base}dict/` }).build((err, t) => {
          if (err) return reject(err)
          tokenizer = t
          resolve(t)
        })
      })
    })()
    loading.catch(() => (loading = null))
  }
  return loading
}

export interface Chunk {
  text: string
  start: number
  end: number
  punct: boolean
  tokens: IpadicFeatures[]
  /** Main (non-prefix) token, used for the dictionary form. */
  head?: IpadicFeatures
  /** Number of base chunks merged into this one. */
  parts: number
  word?: WordInfo
}

const PUNCT_RE = /^[\s　。、，,．.！!？?…‥・「」『』（）()【】〈〉《》“”‘’：:；;—―\-～〜]+$/

function attachesToPrev(t: IpadicFeatures, prev: Chunk) {
  const head = prev.head
  if (!head || prev.punct) return false
  const headInflects = head.pos === '動詞' || head.pos === '形容詞' || head.pos === '助動詞'
  if (t.pos === '助動詞') return headInflects || head.pos === '名詞'
  if ((t.pos === '動詞' || t.pos === '形容詞') && (t.pos_detail_1 === '非自立' || t.pos_detail_1 === '接尾')) return true
  if (t.pos === '名詞' && t.pos_detail_1 === '接尾') return head.pos === '名詞'
  if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && /^(て|で|ちゃ|じゃ)$/.test(t.surface_form)) return headInflects
  return false
}

function baseChunksJa(text: string): Chunk[] {
  const tk = tokenizer
  if (!tk) return [{ text, start: 0, end: text.length, punct: false, tokens: [], parts: 1 }]
  const chunks: Chunk[] = []
  let prefix: IpadicFeatures[] = []
  for (const t of tk.tokenize(text)) {
    const start = t.word_position - 1
    const end = start + t.surface_form.length
    const punct = t.pos === '記号' || PUNCT_RE.test(t.surface_form)
    const prev = chunks[chunks.length - 1]
    if (!punct && t.pos === '接頭詞') {
      prefix.push(t)
      continue
    }
    if (!punct && !prefix.length && prev && attachesToPrev(t, prev)) {
      prev.text += t.surface_form
      prev.end = end
      prev.tokens.push(t)
      continue
    }
    const pStart = prefix.length ? prefix[0].word_position - 1 : start
    chunks.push({
      text: text.slice(pStart, end),
      start: pStart,
      end,
      punct,
      tokens: punct ? [t] : [...prefix, t],
      head: punct ? undefined : t,
      parts: 1,
    })
    prefix = []
  }
  return chunks
}

function baseChunksZh(text: string): Chunk[] {
  const seg = new Intl.Segmenter('zh', { granularity: 'word' })
  return [...seg.segment(text)].map((s) => ({
    text: s.segment,
    start: s.index,
    end: s.index + s.segment.length,
    punct: !s.isWordLike,
    tokens: [],
    parts: 1,
  }))
}

function locate(text: string, words: WordInfo[]) {
  const taken: [number, number][] = []
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y)
  const out: { w: WordInfo; start: number; end: number }[] = []
  let cursor = 0
  for (const w of words) {
    let idx = text.indexOf(w.surface, cursor)
    if (idx < 0 || !free(idx, idx + w.surface.length)) {
      idx = -1
      for (let from = 0; ; ) {
        const j = text.indexOf(w.surface, from)
        if (j < 0) break
        if (free(j, j + w.surface.length)) {
          idx = j
          break
        }
        from = j + 1
      }
    }
    if (idx < 0) continue
    taken.push([idx, idx + w.surface.length])
    out.push({ w, start: idx, end: idx + w.surface.length })
    cursor = idx + w.surface.length
  }
  return out
}

/** Splits a sentence into tappable chunks, aligned with the AI analysis when it is available. */
export function chunkSentence(lang: Lang, text: string, words?: WordInfo[]): Chunk[] {
  const base = lang === 'ja' ? baseChunksJa(text) : baseChunksZh(text)
  if (!words?.length) return base
  const located = locate(text, words)
  for (const c of base) {
    if (c.punct) continue
    let best: (typeof located)[number] | undefined
    let bestOverlap = 0
    for (const l of located) {
      const ov = Math.min(c.end, l.end) - Math.max(c.start, l.start)
      if (ov > bestOverlap) {
        best = l
        bestOverlap = ov
      }
    }
    if (best) c.word = best.w
    else if (lang === 'ja' && c.head) {
      const basic = c.head.basic_form
      c.word = words.find((w) => w.lemma === basic || w.surface === basic)
    }
  }
  // Merge neighbouring chunks that lie inside the same analysed word (e.g. 言い + 切れず).
  const merged: Chunk[] = []
  for (const c of base) {
    const prev = merged[merged.length - 1]
    const range = c.word && located.find((l) => l.w === c.word)
    if (prev && range && prev.word === c.word && prev.start >= range.start && c.end <= range.end) {
      prev.text += c.text
      prev.end = c.end
      prev.tokens.push(...c.tokens)
      prev.parts += 1
      continue
    }
    merged.push({ ...c, tokens: [...c.tokens] })
  }
  return merged
}

/** Hiragana reading of a (dictionary-form) Japanese word using the local dictionary. */
export function readingOf(word: string): string | null {
  if (!word) return null
  if (!hasKanji(word)) return katakanaToHiragana(word)
  const tk = tokenizer
  if (!tk) return null
  const toks = tk.tokenize(word)
  if (toks.some((t) => !t.reading || t.reading === '*')) return null
  return katakanaToHiragana(toks.map((t) => t.reading).join(''))
}

export interface ResolvedWord {
  surface: string
  lemma: string
  reading: string
  pos?: string
  meaning?: string
}

/** Combines the local tokenizer (reliable forms/readings) with the AI analysis (meanings). */
export function resolveWord(lang: Lang, c: Chunk): ResolvedWord {
  const llm = c.word
  if (lang === 'zh') {
    const lemma = llm?.lemma ?? ''
    return { surface: c.text, lemma, reading: readingOf(lemma) ?? llm?.reading ?? '', pos: llm?.pos, meaning: llm?.meaning }
  }
  const head = c.head
  const headBasic = head && head.basic_form !== '*' ? head.basic_form : null
  // Compound verbs such as 言い切る: a second verb attached directly (not via て/で).
  const verbIdx = c.tokens.flatMap((t, i) => (t.pos === '動詞' && !(i > 0 && /^(て|で)$/.test(c.tokens[i - 1].surface_form)) ? [i] : []))
  const compound = verbIdx.length > 1
  let lemma: string
  if (c.parts === 1 && !compound && headBasic) lemma = headBasic
  else if (llm) lemma = llm.lemma
  else if (compound) {
    const last = verbIdx[verbIdx.length - 1]
    lemma = c.tokens.slice(0, last).map((t) => t.surface_form).join('') + c.tokens[last].basic_form
  } else lemma = headBasic ?? c.text
  return {
    surface: c.text,
    lemma,
    reading: readingOf(lemma) ?? llm?.reading ?? '',
    pos: llm?.pos ?? head?.pos,
    meaning: llm?.meaning,
  }
}

/** Ruby segments for one token: [text, reading?][] with okurigana kept outside the ruby. */
export function furiganaParts(t: IpadicFeatures): [string, string?][] {
  const s = t.surface_form
  if (!hasKanji(s) || !t.reading || t.reading === '*') return [[s]]
  const r = katakanaToHiragana(t.reading)
  const hs = katakanaToHiragana(s)
  let pre = 0
  while (pre < s.length && pre < r.length && !hasKanji(s[pre]) && hs[pre] === r[pre]) pre++
  let suf = 0
  while (
    suf < s.length - pre &&
    suf < r.length - pre &&
    !hasKanji(s[s.length - 1 - suf]) &&
    hs[s.length - 1 - suf] === r[r.length - 1 - suf]
  )
    suf++
  const core = s.slice(pre, s.length - suf)
  const coreR = r.slice(pre, r.length - suf)
  const parts: [string, string?][] = []
  if (pre) parts.push([s.slice(0, pre)])
  parts.push([core, coreR || undefined])
  if (suf) parts.push([s.slice(s.length - suf)])
  return parts
}
