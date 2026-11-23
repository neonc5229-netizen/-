import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon, Spinner, TopBar } from '../components/ui'
import { db } from '../lib/db'
import { addFavorite, itemId } from '../lib/favorites'
import { describeInterval } from '../lib/srs'
import type { CompareWord } from '../lib/types'

function WordCard({ w }: { w: CompareWord }) {
  const item = useLiveQuery(() => db.items.get(itemId('word', w.word)), [w.word])
  const nav = useNavigate()
  return (
    <li className="cmp-word">
      <div className="cmp-head">
        <div onClick={() => nav(`/item/word/${encodeURIComponent(w.word)}`, { state: { type: 'word', key: w.word, headword: w.word, reading: w.reading, meaning: w.meaning } })}>
          <div className="reading">{w.reading}</div>
          <div className="cmp-word-title" lang="ja">
            {w.word}
          </div>
        </div>
        <button
          className={`star-btn ${item ? 'on' : ''}`}
          onClick={() => !item && addFavorite({ type: 'word', key: w.word, headword: w.word, reading: w.reading, meaning: w.meaning })}
        >
          <Icon name="star" filled={!!item} size={20} />
          <span>{item ? '已收藏' : '收藏'}</span>
        </button>
      </div>
      <p className="cmp-meaning">{w.meaning}</p>
      <p className="cmp-nuance">{w.nuance}</p>
      {w.example?.ja && (
        <div className="cmp-example">
          <p lang="ja">{w.example.ja}</p>
          <p className="muted">{w.example.zh}</p>
        </div>
      )}
    </li>
  )
}

export default function ComparePage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const group = useLiveQuery(() => db.groups.get(id).then((g) => g ?? null), [id])

  if (group === undefined)
    return (
      <div className="page center">
        <Spinner />
      </div>
    )
  if (!group)
    return (
      <div className="page">
        <TopBar title="相似词辨析" onBack={() => nav(-1)} />
        <p className="muted">找不到这个辨析组</p>
      </div>
    )

  return (
    <div className="page item-page">
      <TopBar title="相似词辨析" onBack={() => nav(-1)} />
      <section className="item-hero column">
        <h2 className="headword cmp-title" lang="ja">
          {group.words.map((w) => w.word).join('・')}
        </h2>
        <div className="item-tags">
          {group.kind && <span className="tag">{group.kind}</span>}
          {group.srs && <span className="muted small">下次复习：{describeInterval(group.srs)}</span>}
        </div>
        <p className="hero-meaning">{group.theme}</p>
      </section>

      {group.keyPoints && (
        <section className="card key-points">
          <h3>区分要点</h3>
          <p>{group.keyPoints}</p>
        </section>
      )}

      <ul className="cmp-list">
        {group.words.map((w) => (
          <WordCard key={w.word} w={w} />
        ))}
      </ul>

      <div className="btn-row sticky-actions">
        <button className="btn primary" disabled={!group.quiz.length} onClick={() => nav(`/review/session?group=${encodeURIComponent(group.id)}`)}>
          练习这一组（{group.quiz.length} 题）
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            if (confirm('删除这个辨析组？')) {
              await db.groups.delete(group.id)
              nav(-1)
            }
          }}
        >
          删除
        </button>
      </div>
    </div>
  )
}
