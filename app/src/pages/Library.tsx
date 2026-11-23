import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, PromptDialog, Sheet, TopBar } from '../components/ui'
import { db, deleteBook } from '../lib/db'
import type { Book, Lang } from '../lib/types'

const TAB_KEY = 'jr-library-tab'

function readTab(): Lang {
  try {
    return localStorage.getItem(TAB_KEY) === 'zh' ? 'zh' : 'ja'
  } catch {
    return 'ja'
  }
}

export default function Library() {
  const nav = useNavigate()
  const [tab, setTab] = useState<Lang>(readTab)
  const [menuBook, setMenuBook] = useState<Book | null>(null)
  const [renaming, setRenaming] = useState<Book | null>(null)
  const books = useLiveQuery(() => db.books.orderBy('openedAt').reverse().toArray(), [], [])
  const counts = { ja: books.filter((b) => b.lang === 'ja').length, zh: books.filter((b) => b.lang === 'zh').length }
  const list = books.filter((b) => b.lang === tab)

  const switchTab = (l: Lang) => {
    setTab(l)
    try {
      localStorage.setItem(TAB_KEY, l)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="page with-nav">
      <TopBar title="书库" />
      <div className="segmented">
        <button className={tab === 'ja' ? 'active' : ''} onClick={() => switchTab('ja')}>
          日语书库 <span className="count">{counts.ja}</span>
        </button>
        <button className={tab === 'zh' ? 'active' : ''} onClick={() => switchTab('zh')}>
          中文书库 <span className="count">{counts.zh}</span>
        </button>
      </div>
      <p className="hint">{tab === 'ja' ? '日译中：点击单词看读音与释义，长按句子看翻译与语法' : '中译日：点击词语看对应日语，长按句子看日语译文与语法'}</p>

      {list.length === 0 ? (
        <div className="empty">
          <p>这个书库还没有书</p>
          <button className="btn primary" onClick={() => nav('/import')}>
            导入文本
          </button>
        </div>
      ) : (
        <ul className="book-list">
          {list.map((b) => {
            const pct = b.paraCount ? Math.round((((b.progressEnd ?? b.progressPara) + 1) / b.paraCount) * 100) : 0
            return (
              <li key={b.id} className="book-card" onClick={() => nav(`/book/${b.id}`)}>
                <div className="book-spine" data-lang={b.lang}>
                  {b.title.slice(0, 1)}
                </div>
                <div className="book-info">
                  <div className="book-title">{b.title}</div>
                  <div className="book-meta">
                    {b.charCount.toLocaleString()} 字 · 已读 {pct}%
                  </div>
                  <div className="progress">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label="更多"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuBook(b)
                  }}
                >
                  <Icon name="more" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button className="fab" onClick={() => nav('/import')} aria-label="导入">
        <Icon name="plus" size={26} />
      </button>

      <Sheet open={!!menuBook} onClose={() => setMenuBook(null)}>
        {menuBook && (
          <div className="action-list">
            <div className="action-title">{menuBook.title}</div>
            <button
              onClick={() => {
                setRenaming(menuBook)
                setMenuBook(null)
              }}
            >
              修改书名
            </button>
            <button
              onClick={async () => {
                await db.books.update(menuBook.id!, { lang: menuBook.lang === 'ja' ? 'zh' : 'ja' })
                setMenuBook(null)
              }}
            >
              移到{menuBook.lang === 'ja' ? '中文' : '日语'}书库
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (confirm(`删除《${menuBook.title}》？收藏的单词和语法会保留。`)) {
                  await deleteBook(menuBook.id!)
                  setMenuBook(null)
                }
              }}
            >
              删除
            </button>
          </div>
        )}
      </Sheet>

      <PromptDialog
        open={!!renaming}
        title="修改书名"
        initial={renaming?.title ?? ''}
        onClose={() => setRenaming(null)}
        onConfirm={async (v) => {
          await db.books.update(renaming!.id!, { title: v })
          setRenaming(null)
        }}
      />
    </div>
  )
}
