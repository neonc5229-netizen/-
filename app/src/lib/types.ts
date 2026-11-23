export type Lang = 'ja' | 'zh'

export interface Book {
  id?: number
  title: string
  lang: Lang
  createdAt: number
  openedAt: number
  paraCount: number
  charCount: number
  /** First paragraph of the page the reader was last on. */
  progressPara: number
  /** Sentence (within progressPara) at the top of the screen. */
  progressSent?: number
  /** Last paragraph read so far on screen (for the progress bar). */
  progressEnd?: number
  bookmarks?: Bookmark[]
}

export interface Bookmark {
  p: number
  s: number
  /** The sentence, for display. */
  text: string
  at: number
}

export interface Paragraph {
  id?: number
  bookId: number
  idx: number
  sentences: string[]
}

export interface GrammarInfo {
  pattern: string
  jlpt?: string
  meaning: string
  explanation?: string
}

export interface WordInfo {
  /** Text as it appears in the source sentence. */
  surface: string
  /** Japanese dictionary form (for Chinese sources: the corresponding Japanese word). */
  lemma: string
  reading: string
  pos?: string
  meaning: string
}

export interface Analysis {
  /** `${lang}|${sentence}` */
  key: string
  lang: Lang
  text: string
  translation: string
  grammar: GrammarInfo[]
  words: WordInfo[]
  model: string
  at: number
}

export type ItemType = 'word' | 'grammar'

export interface Source {
  bookId: number
  para: number
  sent: number
  lang: Lang
  /** The sentence in the book. */
  text: string
  /** Its translation (Chinese for Japanese books, Japanese for Chinese books). */
  translation?: string
  /** The exact text that was tapped, for words. */
  surface?: string
  at: number
}

export interface SrsState {
  due: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  last?: number
}

export interface Item {
  /** `${type}:${key}` */
  id: string
  type: ItemType
  key: string
  headword: string
  reading?: string
  meaning: string
  jlpt?: string
  pos?: string
  sources: Source[]
  createdAt: number
  srs?: SrsState
}

export interface CompareWord {
  word: string
  reading: string
  meaning: string
  nuance: string
  example: { ja: string; zh: string }
}

export interface CompareQuiz {
  /** Japanese sentence with ＿＿ for the blank. */
  sentence: string
  /** Dictionary form of the correct word (one of the group's words). */
  answer: string
  /** The sentence with the correct (conjugated) word filled in. */
  filled: string
  translation: string
  explain: string
}

/** A set of easily confused words (similar meaning and/or similar shape) for comparison review. */
export interface CompareGroup {
  /** Words joined by ・ in sorted order. */
  id: string
  theme: string
  kind: string
  words: CompareWord[]
  keyPoints: string
  quiz: CompareQuiz[]
  model: string
  createdAt: number
  srs?: SrsState
}

export interface AudioClip {
  /** `${model}|${voice}|${text}` */
  key: string
  blob: Blob
  at: number
}

export interface Detail {
  /** `${type}:${key}` or `lookup:...` */
  id: string
  data: unknown
  model: string
  at: number
}
