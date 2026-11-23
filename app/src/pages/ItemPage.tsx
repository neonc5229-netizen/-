import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Icon, JlptBadge, Spinner, TopBar } from '../components/ui'
import { generateGroupFor } from '../lib/compare'
import { db } from '../lib/db'
import { addFavorite, itemId, removeFavoriteSource, removeItem, type ItemSeed } from '../lib/favorites'
import { grammarDetail, wordDetail, type GrammarDetail, type WordDetail } from '../lib/llm'
import { useSettings } from '../lib/settings'
import type { ItemType, Source } from '../lib/types'

/** Detail requests in flight, shared across mounts so a page is never generated twice at once. */
const inflight = new Map<string, Promise<void>>()

function CompareSection({ headword, meaning }: { headword: string; meaning: string }) {
  const nav = useNavigate()
  const settings = useSettings()
  const groups = useLiveQuery(
    () => db.groups.toArray().then((all) => all.filter((g) => g.words.some((w) => w.word === headword))),
    [headword],
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!groups) return null
  return (
    <section className="card">
      <h3>相似词辨析</h3>
      {groups.map((g) => (
        <button key={g.id} className="group-link" onClick={() => nav(`/compare/${encodeURIComponent(g.id)}`)}>
          <span lang="ja">{g.words.map((w) => w.word).join('・')}</span>
          <span className="muted small">{g.theme}</span>
        </button>
      ))}
      {!groups.length && <p className="muted small">还没有辨析组。AI 会找出与这个词意思相近或字形相似、容易混淆的词，并出对比填空题。</p>}
      {err && <p className="error small">{err}</p>}
      {!groups.length && (
        <button
          className="btn ghost block"
          disabled={busy || !settings.apiKey}
          onClick={async () => {
            setBusy(true)
            setErr('')
            try {
              const saved = await generateGroupFor({ headword, meaning })
              if (!saved.length) setErr('没有找到合适的相似词')
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Spinner label="生成中…" /> : '生成相似词辨析'}
        </button>
      )}
    </section>
  )
}

function Highlight({ text, mark }: { text: string; mark?: string }) {
  const i = mark ? text.indexOf(mark) : -1
  if (!mark || i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{mark}</mark>
      {text.slice(i + mark.length)}
    </>
  )
}

export default function ItemPage() {
  const params = useParams()
  const type = params.type as ItemType
  const key = params.key ?? ''
  const nav = useNavigate()
  const loc = useLocation()
  const settings = useSettings()
  const id = itemId(type, key)
  const item = useLiveQuery(() => db.items.get(id), [id])
  const detailRow = useLiveQuery(() => db.details.get(id).then((d) => d ?? null), [id])
  const books = useLiveQuery(() => db.books.toArray(), [], [])
  const [error, setError] = useState('')
  const asked = useRef('')

  const seed: ItemSeed = item ?? (loc.state as ItemSeed | null) ?? { type, key, headword: key, meaning: '' }

  const fetchDetail = (force = false) => {
    if (!settings.apiKey) return
    if (!force && asked.current === id) return
    asked.current = id
    setError('')
    let p = inflight.get(id)
    if (!p) {
      p = (type === 'word' ? wordDetail(seed.headword, seed.reading) : grammarDetail(seed.headword))
        .then(({ detail, model }) => db.details.put({ id, data: detail, model, at: Date.now() }))
        .then(() => undefined)
        .finally(() => inflight.delete(id))
      inflight.set(id, p)
    }
    p.catch((e) => setError(e.message))
  }

  useEffect(() => {
    if (detailRow === null) fetchDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRow, id, settings.apiKey])

  const bookTitle = (bid: number) => books.find((b) => b.id === bid)?.title
  const openSource = (s: Source) => {
    if (!bookTitle(s.bookId)) return
    nav(`/book/${s.bookId}?p=${s.para}&s=${s.sent}`)
  }

  const word = type === 'word' ? (detailRow?.data as WordDetail | undefined) : undefined
  const gram = type === 'grammar' ? (detailRow?.data as GrammarDetail | undefined) : undefined

  return (
    <div className="page item-page">
      <TopBar title={type === 'word' ? '单词' : '语法'} onBack={() => nav(-1)} />

      <section className="item-hero">
        <div>
          {type === 'word' && <div className="reading">{word?.reading || seed.reading}</div>}
          <h2 className="headword" lang="ja">
            {seed.headword}
          </h2>
          <div className="item-tags">
            {(gram?.jlpt || seed.jlpt) && <JlptBadge jlpt={gram?.jlpt || seed.jlpt} />}
            {(word?.pos || seed.pos) && <span className="tag">{word?.pos || seed.pos}</span>}
          </div>
          {seed.meaning && <p className="hero-meaning">{seed.meaning}</p>}
        </div>
        <button
          className={`star-btn big ${item ? 'on' : ''}`}
          onClick={() => {
            if (item) {
              if (confirm('取消收藏，并删除所有来源句？')) removeItem(type, key)
            } else addFavorite(seed)
          }}
        >
          <Icon name="star" filled={!!item} />
          <span>{item ? '已收藏' : '收藏'}</span>
        </button>
      </section>

      {item && item.sources.length > 0 && (
        <section className="card">
          <h3>来源句（{item.sources.length}）</h3>
          <ul className="source-list">
            {item.sources.map((s, i) => {
              const title = bookTitle(s.bookId)
              return (
                <li key={i} onClick={() => openSource(s)} className={title ? '' : 'disabled'}>
                  <p className="src-text" lang={s.lang === 'ja' ? 'ja' : 'zh-CN'}>
                    <Highlight text={s.text} mark={s.surface} />
                  </p>
                  {s.translation && <p className="src-trans">{s.translation}</p>}
                  <div className="src-meta">
                    <span>{title ? `《${title}》` : '（书已删除）'}</span>
                    <button
                      className="link small"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFavoriteSource(type, key, s)
                      }}
                    >
                      移除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {type === 'word' && <CompareSection headword={seed.headword} meaning={seed.meaning} />}

      <section className="card">
        <h3>
          详细讲解
          {detailRow && (
            <button className="link small" onClick={() => fetchDetail(true)}>
              <Icon name="refresh" size={14} /> 重新生成
            </button>
          )}
        </h3>
        {detailRow === undefined ? null : detailRow === null ? (
          error ? (
            <div className="error-box">
              <p>{error}</p>
              <button className="btn ghost" onClick={() => fetchDetail(true)}>
                重试
              </button>
            </div>
          ) : settings.apiKey ? (
            <Spinner label={`正在用 ${settings.deepModel} 生成讲解…`} />
          ) : (
            <p className="muted">填写 API Key 后可生成详细讲解</p>
          )
        ) : word ? (
          <WordDetailView d={word} />
        ) : gram ? (
          <GrammarDetailView d={gram} />
        ) : null}
      </section>
    </div>
  )
}

function Examples({ list }: { list?: { ja: string; zh: string }[] }) {
  if (!list?.length) return null
  return (
    <>
      <h4>例句</h4>
      <ul className="examples">
        {list.map((e, i) => (
          <li key={i}>
            <p lang="ja">{e.ja}</p>
            <p className="muted">{e.zh}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function WordDetailView({ d }: { d: WordDetail }) {
  return (
    <div className="detail">
      {d.meanings?.length > 0 && (
        <ol className="meanings">
          {d.meanings.map((m, i) => (
            <li key={i}>
              {m.meaning}
              {m.note && <span className="muted"> — {m.note}</span>}
            </li>
          ))}
        </ol>
      )}
      {d.usage && (
        <>
          <h4>用法</h4>
          <p>{d.usage}</p>
        </>
      )}
      {d.collocations?.length ? (
        <>
          <h4>常见搭配</h4>
          <div className="chips" lang="ja">
            {d.collocations.map((c, i) => (
              <span key={i} className="chip">
                {c}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <Examples list={d.examples} />
      {d.synonyms?.length ? (
        <>
          <h4>近义词辨析</h4>
          <ul className="compare">
            {d.synonyms.map((s, i) => (
              <li key={i}>
                <strong lang="ja">{s.word}</strong>
                <p>{s.diff}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function GrammarDetailView({ d }: { d: GrammarDetail }) {
  return (
    <div className="detail">
      <p className="lead">{d.meaning}</p>
      {d.connection && (
        <>
          <h4>接续</h4>
          <p className="connection" lang="ja">
            {d.connection}
          </p>
        </>
      )}
      {d.usage && (
        <>
          <h4>用法</h4>
          <p>{d.usage}</p>
        </>
      )}
      {d.nuance && (
        <>
          <h4>语感与注意</h4>
          <p>{d.nuance}</p>
        </>
      )}
      <Examples list={d.examples} />
      {d.similar?.length ? (
        <>
          <h4>近义语法辨析</h4>
          <ul className="compare">
            {d.similar.map((s, i) => (
              <li key={i}>
                <strong lang="ja">{s.pattern}</strong>
                <p>{s.diff}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
