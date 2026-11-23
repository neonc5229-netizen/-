import type { Lang } from './types'

/** Splits a paragraph into sentences, keeping closing punctuation and quotes with the sentence. */
export function splitSentences(paragraph: string): string[] {
  const re = /[^。！？!?…]+(?:[。！？!?…]+|$)[」』）)”’】〉》]*/g
  const out: string[] = []
  for (const m of paragraph.matchAll(re)) {
    const s = m[0].trim()
    if (!s) continue
    // Attach stray closing marks to the previous sentence.
    if (out.length && /^[」』）)”’】〉》、，,]+$/.test(s)) out[out.length - 1] += s
    else out.push(s)
  }
  return out.length ? out : [paragraph.trim()]
}

export function splitParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((p) => p.replace(/^[\s　]+|[\s　]+$/g, ''))
    .filter(Boolean)
    .map(splitSentences)
}

/** Japanese text always contains kana; Chinese text practically never does. */
export function detectLang(text: string): Lang {
  const sample = text.slice(0, 20000)
  const kana = (sample.match(/[぀-ヿ]/g) || []).length
  const han = (sample.match(/[一-鿿]/g) || []).length
  if (kana + han === 0) return 'ja'
  return kana / (kana + han) > 0.08 ? 'ja' : 'zh'
}

export async function readFileText(file: File): Promise<string> {
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return value
  }
  const buf = await file.arrayBuffer()
  // Try UTF-8 first; fall back to legacy encodings common for Japanese / Chinese txt files.
  for (const enc of ['utf-8', 'shift_jis', 'gb18030']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf)
    } catch {
      /* try next */
    }
  }
  return new TextDecoder('utf-8').decode(buf)
}

export function katakanaToHiragana(s: string) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

export const hasKanji = (s: string) => /[㐀-鿿々]/.test(s)

export function jlptLevel(jlpt?: string): number | null {
  const m = jlpt?.match(/N\s*([1-5])/i)
  return m ? Number(m[1]) : null
}

export function grammarKey(pattern: string) {
  return pattern.replace(/[〜~～\s（）()「」]/g, '').replace(/／/g, '/')
}
