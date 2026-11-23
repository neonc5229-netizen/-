import { getSettings } from './settings'
import type { GrammarInfo, Lang, WordInfo } from './types'

export class LlmError extends Error {}

function parseJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  try {
    return JSON.parse(t)
  } catch {
    // Some models leave trailing commas.
    return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'))
  }
}

async function callModel(model: string, system: string, user: string, maxTokens: number, schema?: JsonSchema) {
  const s = getSettings()
  if (!s.apiKey) throw new LlmError('请先在「设置」中填写 API Key')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const res = await fetch(`${s.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: schema ? { type: 'json_schema', json_schema: schema } : { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        const j = await res.json()
        msg += ' ' + (j?.error?.message ?? '')
      } catch {
        /* ignore */
      }
      throw new LlmError(`模型 ${model} 请求失败：${msg}`)
    }
    const j = await res.json()
    const content: string = j?.choices?.[0]?.message?.content ?? ''
    if (!content) throw new LlmError(`模型 ${model} 没有返回内容`)
    return parseJson(content)
  } catch (e) {
    if (e instanceof LlmError) throw e
    if ((e as Error).name === 'AbortError') throw new LlmError(`模型 ${model} 请求超时`)
    if (e instanceof SyntaxError) throw new LlmError(`模型 ${model} 返回的格式无法解析`)
    throw new LlmError(`网络错误：${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

type JsonSchema = { name: string; strict: true; schema: Record<string, unknown> }

const str = { type: 'string' }
function obj(props: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props }
}
const WORD_SCHEMA = obj({ surface: str, lemma: str, reading: str, pos: str, meaning: str })
const ANALYSIS_SCHEMA: JsonSchema = {
  name: 'analysis',
  strict: true,
  schema: obj({
    sentences: {
      type: 'array',
      items: obj({
        i: { type: 'integer' },
        translation: str,
        grammar: { type: 'array', items: obj({ pattern: str, jlpt: str, meaning: str, explanation: str }) },
        words: { type: 'array', items: WORD_SCHEMA },
      }),
    },
  }),
}
const LOOKUP_SCHEMA: JsonSchema = { name: 'word', strict: true, schema: WORD_SCHEMA }

/**
 * Calls the primary model (retrying once on malformed output), then the fallback model.
 * The schema constrains the primary model's output; the fallback gets plain JSON mode,
 * which tested more reliable for it.
 */
async function ask(kind: 'fast' | 'deep', system: string, user: string, maxTokens = 8000, schema?: JsonSchema) {
  const s = getSettings()
  const primary = kind === 'deep' ? s.deepModel : s.model
  const attempts: [string, JsonSchema | undefined][] = [
    [primary, schema],
    [primary, schema],
  ]
  if (s.fallbackModel && s.fallbackModel !== primary) attempts.push([s.fallbackModel, undefined])
  let last: unknown
  for (const [m, sc] of attempts) {
    if (!m) continue
    try {
      return { data: (await callModel(m, system, user, maxTokens, sc)) as Record<string, unknown>, model: m }
    } catch (e) {
      last = e
      if ((e as Error).message.includes('API Key')) break
    }
  }
  throw last
}

const LEVEL_NOTE =
  '用户日语水平N2-N1，母语中文。grammar列出N3及以上、对中高级学习者有价值的语法（如〜ざるを得ない、〜なり、〜たところで），不要列です/ます/て形/た形/の/が等基础语法。'

function analysisPrompt(lang: Lang) {
  if (lang === 'ja')
    return `你是日语教学助手。${LEVEL_NOTE}
逐句分析用户给出的日语句子数组，只输出JSON：
{"sentences":[{"i":序号,"translation":"自然流畅的中文翻译","grammar":[{"pattern":"语法的标准形式，如〜ば〜ほど","jlpt":"N1|N2|N3","meaning":"简短中文含义","explanation":"在本句中的用法"}],"words":[{"surface":"句中原文，必须与原句文字完全一致","lemma":"辞书形","reading":"辞书形的平假名读音","pos":"词性（中文）","meaning":"结合语境的中文释义"}]}]}
words列出句中所有实词（名词、动词、形容词、副词、连体词、惯用语等），略去助词、助动词和标点。`
  return `你是日语教学助手，帮助中文母语者把中文翻译成日语来学习。${LEVEL_NOTE}
逐句把用户给出的中文句子数组翻译成日语，只输出JSON：
{"sentences":[{"i":序号,"translation":"自然地道的日语翻译","grammar":[{"pattern":"日语译文中用到的语法的标准形式","jlpt":"N1|N2|N3","meaning":"简短中文含义","explanation":"在译文中的用法"}],"words":[{"surface":"中文原句中的词，必须与原句文字完全一致","lemma":"译文中对应的日语词（辞书形）","reading":"该日语词的平假名读音","pos":"日语词的词性（中文）","meaning":"该日语词的中文释义"}]}]}
words列出中文原句中所有实词及其在日语译文中的对应词，略去虚词和标点。`
}

export interface SentenceAnalysis {
  translation: string
  grammar: GrammarInfo[]
  words: WordInfo[]
}

function cleanWords(arr: unknown): WordInfo[] {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((w) => w && typeof w.surface === 'string' && w.surface)
    .map((w) => ({
      surface: String(w.surface),
      lemma: String(w.lemma || w.surface),
      reading: String(w.reading || ''),
      pos: w.pos ? String(w.pos) : undefined,
      meaning: String(w.meaning || ''),
    }))
}

function cleanGrammar(arr: unknown): GrammarInfo[] {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((g) => g && typeof g.pattern === 'string' && g.pattern)
    .map((g) => ({
      pattern: String(g.pattern),
      jlpt: g.jlpt ? String(g.jlpt) : undefined,
      meaning: String(g.meaning || ''),
      explanation: g.explanation ? String(g.explanation) : undefined,
    }))
}

export async function analyzeSentences(lang: Lang, sentences: string[]) {
  const user = JSON.stringify(sentences.map((text, i) => ({ i, text })))
  const { data, model } = await ask('fast', analysisPrompt(lang), user, 8000, ANALYSIS_SCHEMA)
  const list = Array.isArray(data.sentences) ? data.sentences : []
  const result: (SentenceAnalysis | null)[] = sentences.map(() => null)
  list.forEach((s: Record<string, unknown>, pos: number) => {
    const i = typeof s.i === 'number' ? s.i : pos
    if (i < 0 || i >= sentences.length || typeof s.translation !== 'string') return
    result[i] = { translation: s.translation, grammar: cleanGrammar(s.grammar), words: cleanWords(s.words) }
  })
  return { result, model }
}

export async function lookupWord(lang: Lang, sentence: string, surface: string) {
  const system =
    lang === 'ja'
      ? '你是日语词典。根据句子语境解释指定的日语词，只输出JSON：{"surface":"原文","lemma":"辞书形","reading":"辞书形平假名读音","pos":"词性（中文）","meaning":"结合语境的中文释义"}'
      : '你是中日词典。给出中文句子中指定中文词在日语中的对应词，只输出JSON：{"surface":"中文原词","lemma":"对应日语词辞书形","reading":"平假名读音","pos":"日语词的词性（中文）","meaning":"该日语词的中文释义"}'
  const { data, model } = await ask('fast', system, `句子：${sentence}\n词：${surface}`, 1000, LOOKUP_SCHEMA)
  return { word: cleanWords([{ surface, ...data }])[0], model }
}

export interface WordDetail {
  headword: string
  reading: string
  pos?: string
  meanings: { meaning: string; note?: string }[]
  usage?: string
  collocations?: string[]
  examples: { ja: string; zh: string }[]
  synonyms?: { word: string; diff: string }[]
}

export interface GrammarDetail {
  pattern: string
  jlpt?: string
  meaning: string
  connection?: string
  usage?: string
  nuance?: string
  examples: { ja: string; zh: string }[]
  similar?: { pattern: string; diff: string }[]
}

export async function wordDetail(headword: string, reading?: string) {
  const system = `你是面向中文母语者的日语词典编辑，用户水平N2-N1。为指定日语词编写详细词条，只输出JSON：
{"headword":"辞书形","reading":"平假名","pos":"词性","meanings":[{"meaning":"中文释义","note":"使用场合或补充"}],"usage":"用法说明（语体、搭配习惯、易错点）","collocations":["常见搭配"],"examples":[{"ja":"日语例句","zh":"中文翻译"}],"synonyms":[{"word":"近义词","diff":"与本词的区别"}]}
examples给3-5个自然的例句。`
  const { data, model } = await ask('deep', system, reading ? `${headword}（${reading}）` : headword)
  return { detail: data as unknown as WordDetail, model }
}

export async function grammarDetail(pattern: string) {
  const system = `你是面向中文母语者的日语语法讲师，用户水平N2-N1。为指定语法编写详细讲解，只输出JSON：
{"pattern":"标准形式","jlpt":"N1-N5","meaning":"中文含义","connection":"接续方式","usage":"用法说明","nuance":"语感、语体与注意点","examples":[{"ja":"日语例句","zh":"中文翻译"}],"similar":[{"pattern":"近义语法","diff":"区别"}]}
examples给3-5个自然的例句。`
  const { data, model } = await ask('deep', system, pattern)
  return { detail: data as unknown as GrammarDetail, model }
}

// ---------- batch details (several items per request to save API cost) ----------

const EXAMPLES = { type: 'array', items: obj({ ja: str, zh: str }) }
const WORD_DETAIL = obj({
  i: { type: 'integer' },
  headword: str,
  reading: str,
  pos: str,
  meanings: { type: 'array', items: obj({ meaning: str, note: str }) },
  usage: str,
  collocations: { type: 'array', items: str },
  examples: EXAMPLES,
  synonyms: { type: 'array', items: obj({ word: str, diff: str }) },
})
const GRAMMAR_DETAIL = obj({
  i: { type: 'integer' },
  pattern: str,
  jlpt: str,
  meaning: str,
  connection: str,
  usage: str,
  nuance: str,
  examples: EXAMPLES,
  similar: { type: 'array', items: obj({ pattern: str, diff: str }) },
})
const batchSchema = (item: unknown): JsonSchema => ({
  name: 'details',
  strict: true,
  schema: obj({ items: { type: 'array', items: item } }),
})

export type BatchQuality = 'fast' | 'deep'

export async function wordDetailsBatch(words: { headword: string; reading?: string }[], quality: BatchQuality) {
  const system = `你是面向中文母语者的日语词典编辑，用户水平N2-N1。为用户给出的每个日语词分别编写详细词条，按输入顺序输出JSON：
{"items":[{"i":输入序号,"headword":"辞书形","reading":"平假名","pos":"词性","meanings":[{"meaning":"中文释义","note":"使用场合或补充"}],"usage":"用法说明（语体、搭配习惯、易错点）","collocations":["常见搭配"],"examples":[{"ja":"日语例句","zh":"中文翻译"}],"synonyms":[{"word":"近义词","diff":"与本词的区别"}]}]}
每个词给3-4个自然的例句。`
  const user = JSON.stringify(words.map((w, i) => ({ i, headword: w.headword, reading: w.reading ?? '' })))
  const { data, model } = await ask(quality, system, user, 16000, batchSchema(WORD_DETAIL))
  return { items: alignBatch(data.items, words.length) as (WordDetail | null)[], model }
}

export async function grammarDetailsBatch(patterns: string[], quality: BatchQuality) {
  const system = `你是面向中文母语者的日语语法讲师，用户水平N2-N1。为用户给出的每个语法分别编写详细讲解，按输入顺序输出JSON：
{"items":[{"i":输入序号,"pattern":"标准形式","jlpt":"N1-N5","meaning":"中文含义","connection":"接续方式","usage":"用法说明","nuance":"语感、语体与注意点","examples":[{"ja":"日语例句","zh":"中文翻译"}],"similar":[{"pattern":"近义语法","diff":"区别"}]}]}
每个语法给3-4个自然的例句。`
  const user = JSON.stringify(patterns.map((pattern, i) => ({ i, pattern })))
  const { data, model } = await ask(quality, system, user, 16000, batchSchema(GRAMMAR_DETAIL))
  return { items: alignBatch(data.items, patterns.length) as (GrammarDetail | null)[], model }
}

function alignBatch(raw: unknown, n: number) {
  const out: (Record<string, unknown> | null)[] = Array(n).fill(null)
  if (!Array.isArray(raw)) return out
  raw.forEach((r, pos) => {
    if (!r || typeof r !== 'object') return
    const i = typeof r.i === 'number' && r.i >= 0 && r.i < n ? r.i : pos < n ? pos : -1
    if (i >= 0 && !out[i]) out[i] = r
  })
  return out
}

export async function testConnection() {
  const { model } = await ask('fast', '只输出JSON：{"ok":true}', 'ping', 100)
  return model
}
