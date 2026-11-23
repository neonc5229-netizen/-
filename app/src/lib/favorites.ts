import { db } from './db'
import { grammarKey } from './text'
import type { GrammarInfo, Item, ItemType, Source } from './types'
import type { ResolvedWord } from './tokenize'

export const itemId = (type: ItemType, key: string) => `${type}:${key}`

export function wordItemKey(w: { lemma: string }) {
  return w.lemma.trim()
}

export const sameSource = (a: Source, b: Pick<Source, 'bookId' | 'para' | 'sent'>) =>
  a.bookId === b.bookId && a.para === b.para && a.sent === b.sent

export interface ItemSeed {
  type: ItemType
  key: string
  headword: string
  reading?: string
  meaning: string
  jlpt?: string
  pos?: string
}

export function seedFromWord(w: ResolvedWord): ItemSeed {
  return { type: 'word', key: wordItemKey(w), headword: w.lemma, reading: w.reading, meaning: w.meaning ?? '', pos: w.pos }
}

export function seedFromGrammar(g: GrammarInfo): ItemSeed {
  return { type: 'grammar', key: grammarKey(g.pattern), headword: g.pattern, meaning: g.meaning, jlpt: g.jlpt }
}

/** Adds the item (or just this source sentence) to the favourites. */
export async function addFavorite(seed: ItemSeed, source?: Source) {
  const id = itemId(seed.type, seed.key)
  await db.transaction('rw', db.items, async () => {
    const existing = await db.items.get(id)
    if (existing) {
      if (source && !existing.sources.some((s) => sameSource(s, source))) {
        existing.sources.push(source)
        await db.items.put(existing)
      }
      return
    }
    const item: Item = {
      id,
      type: seed.type,
      key: seed.key,
      headword: seed.headword,
      reading: seed.reading,
      meaning: seed.meaning,
      jlpt: seed.jlpt,
      pos: seed.pos,
      sources: source ? [source] : [],
      createdAt: Date.now(),
    }
    await db.items.put(item)
  })
}

/** Removes one source sentence; the item itself is removed when it has no sources left. */
export async function removeFavoriteSource(type: ItemType, key: string, source: Pick<Source, 'bookId' | 'para' | 'sent'>) {
  const id = itemId(type, key)
  await db.transaction('rw', db.items, async () => {
    const existing = await db.items.get(id)
    if (!existing) return
    existing.sources = existing.sources.filter((s) => !sameSource(s, source))
    if (existing.sources.length) await db.items.put(existing)
    else await db.items.delete(id)
  })
}

export async function removeItem(type: ItemType, key: string) {
  await db.items.delete(itemId(type, key))
}
