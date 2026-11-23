import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, JlptBadge, TopBar } from '../components/ui'
import { db } from '../lib/db'
import type { ItemType } from '../lib/types'

export default function Favorites() {
  const nav = useNavigate()
  const [tab, setTab] = useState<ItemType>('word')
  const [q, setQ] = useState('')
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), [], [])
  const counts = { word: items.filter((i) => i.type === 'word').length, grammar: items.filter((i) => i.type === 'grammar').length }
  const query = q.trim()
  const list = items.filter(
    (i) => i.type === tab && (!query || i.headword.includes(query) || i.reading?.includes(query) || i.meaning.includes(query)),
  )

  return (
    <div className="page with-nav">
      <TopBar title="收藏" />
      <div className="segmented">
        <button className={tab === 'word' ? 'active' : ''} onClick={() => setTab('word')}>
          单词 <span className="count">{counts.word}</span>
        </button>
        <button className={tab === 'grammar' ? 'active' : ''} onClick={() => setTab('grammar')}>
          语法 <span className="count">{counts.grammar}</span>
        </button>
      </div>
      <div className="search">
        <Icon name="search" size={18} />
        <input placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <div className="empty">
          <p>{query ? '没有找到' : `还没有收藏的${tab === 'word' ? '单词' : '语法'}`}</p>
          {!query && <p className="muted small">阅读时点击单词或长按句子，然后点「收藏」</p>}
        </div>
      ) : (
        <ul className="item-list">
          {list.map((i) => (
            <li key={i.id} onClick={() => nav(`/item/${i.type}/${encodeURIComponent(i.key)}`)}>
              <div className="item-main">
                <div className="item-head" lang="ja">
                  <span className="hw">{i.headword}</span>
                  {i.reading && i.reading !== i.headword && <span className="rd">{i.reading}</span>}
                  <JlptBadge jlpt={i.jlpt} />
                </div>
                <div className="item-meaning">{i.meaning}</div>
              </div>
              <span className="src-count">{i.sources.length} 句</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
