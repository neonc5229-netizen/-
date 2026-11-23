import Dexie, { type EntityTable } from 'dexie'
import type { Analysis, AudioClip, Book, Detail, Item, Paragraph } from './types'

export const db = new Dexie('japanese-reader') as Dexie & {
  books: EntityTable<Book, 'id'>
  paragraphs: EntityTable<Paragraph, 'id'>
  analyses: EntityTable<Analysis, 'key'>
  items: EntityTable<Item, 'id'>
  details: EntityTable<Detail, 'id'>
  audio: EntityTable<AudioClip, 'key'>
}

db.version(1).stores({
  books: '++id, lang, openedAt',
  paragraphs: '++id, [bookId+idx], bookId',
  analyses: 'key',
  items: 'id, type, createdAt',
  details: 'id',
})

db.version(2).stores({
  audio: 'key, at',
})

export async function deleteBook(bookId: number) {
  await db.transaction('rw', db.books, db.paragraphs, async () => {
    await db.paragraphs.where('bookId').equals(bookId).delete()
    await db.books.delete(bookId)
  })
}

export async function exportAll() {
  return {
    app: 'japanese-reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: await db.books.toArray(),
    paragraphs: await db.paragraphs.toArray(),
    analyses: await db.analyses.toArray(),
    items: await db.items.toArray(),
    details: await db.details.toArray(),
  }
}

export async function importAll(data: Awaited<ReturnType<typeof exportAll>>) {
  if (data?.app !== 'japanese-reader') throw new Error('不是本应用导出的备份文件')
  await db.transaction('rw', [db.books, db.paragraphs, db.analyses, db.items, db.details], async () => {
    await Promise.all([db.books.clear(), db.paragraphs.clear(), db.analyses.clear(), db.items.clear(), db.details.clear()])
    await db.books.bulkPut(data.books)
    await db.paragraphs.bulkPut(data.paragraphs)
    await db.analyses.bulkPut(data.analyses)
    await db.items.bulkPut(data.items)
    await db.details.bulkPut(data.details)
  })
}
