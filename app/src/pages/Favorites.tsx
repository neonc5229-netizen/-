import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, JlptBadge, Sheet, Spinner, TopBar } from '../components/ui'
import { cancelBatch, runBatch, useBatch } from '../lib/batch'
import { db } from '../lib/db'
import { useSettings } from '../lib/settings'
import type { ItemType } from '../lib/types'

export default function Favorites() {
  const nav = useNavigate()
  const settings = useSettings()
  const batch = useBatch()
  const [tab, setTab] = useState<ItemType>('word')
  const [q, setQ] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), [], [])
  const detailIds = useLiveQuery(
    async () => new Set((await db.details.bulkGet(items.map((i) => i.id))).flatMap((d) => (d ? [d.id] : []))),
    [items],
    new Set<string>(),
  )
  const counts = { word: items.filter((i) => i.type === 'word').length, grammar: items.filter((i) => i.type === 'grammar').length }
  const query = q.trim()
  const list = items.filter(
    (i) => i.type === tab && (!query || i.headword.includes(query) || i.reading?.includes(query) || i.meaning.includes(query)),
  )
  const visibleSelected = list.filter((i) => selected.has(i.id))
  const pending = visibleSelected.filter((i) => !detailIds.has(i.id))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectAll = (onlyMissing: boolean) =>
    setSelected(new Set(list.filter((i) => !onlyMissing || !detailIds.has(i.id)).map((i) => i.id)))
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const start = (quality: 'fast' | 'deep') => {
    setConfirmOpen(false)
    runBatch(visibleSelected, quality)
    exitSelect()
  }

  return (
    <div className={`page with-nav ${selecting ? 'with-actions' : ''}`}>
      <TopBar
        title="收藏"
        right={
          list.length > 0 && (
            <button className="icon-btn text-btn" onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
              {selecting ? '完成' : '选择'}
            </button>
          )
        }
      />
      <div className="segmented">
        <button className={tab === 'word' ? 'active' : ''} onClick={() => (setTab('word'), setSelected(new Set()))}>
          单词 <span className="count">{counts.word}</span>
        </button>
        <button className={tab === 'grammar' ? 'active' : ''} onClick={() => (setTab('grammar'), setSelected(new Set()))}>
          语法 <span className="count">{counts.grammar}</span>
        </button>
      </div>

      {(batch.running || batch.total > 0) && (
        <div className={`batch-banner ${batch.running ? '' : batch.failed ? 'warn' : 'ok'}`}>
          {batch.running ? (
            <>
              <Spinner label={`正在生成详解 ${batch.done + batch.failed} / ${batch.total}`} />
              <button className="link small" onClick={cancelBatch}>
                停止
              </button>
            </>
          ) : (
            <span>
              {batch.total === 0
                ? '所选条目都已有详解，无需生成'
                : `已生成 ${batch.done} 条详解${batch.failed ? `，${batch.failed} 条失败${batch.error ? `（${batch.error}）` : ''}，可再次选择重试` : ''}`}
            </span>
          )}
        </div>
      )}

      <div className="search">
        <Icon name="search" size={18} />
        <input placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {selecting && (
        <div className="select-tools">
          <button className="link small" onClick={() => selectAll(false)}>
            全选
          </button>
          <button className="link small" onClick={() => selectAll(true)}>
            选择未生成详解的
          </button>
          <button className="link small" onClick={() => setSelected(new Set())}>
            清空
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <p>{query ? '没有找到' : `还没有收藏的${tab === 'word' ? '单词' : '语法'}`}</p>
          {!query && <p className="muted small">阅读时点击单词或长按句子，然后点「收藏」</p>}
        </div>
      ) : (
        <ul className="item-list">
          {list.map((i) => (
            <li
              key={i.id}
              className={selecting && selected.has(i.id) ? 'picked' : ''}
              onClick={() => (selecting ? toggle(i.id) : nav(`/item/${i.type}/${encodeURIComponent(i.key)}`))}
            >
              {selecting && <span className={`check ${selected.has(i.id) ? 'on' : ''}`} aria-hidden />}
              <div className="item-main">
                <div className="item-head" lang="ja">
                  <span className="hw">{i.headword}</span>
                  {i.reading && i.reading !== i.headword && <span className="rd">{i.reading}</span>}
                  <JlptBadge jlpt={i.jlpt} />
                </div>
                <div className="item-meaning">{i.meaning}</div>
              </div>
              <div className="item-side">
                <span className="src-count">{i.sources.length} 句</span>
                {detailIds.has(i.id) && <span className="has-detail">详解 ✓</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {selecting && (
        <div className="action-bar">
          <span className="muted small">已选 {visibleSelected.length}</span>
          <button
            className="btn ghost"
            disabled={!visibleSelected.length}
            onClick={async () => {
              if (confirm(`删除所选的 ${visibleSelected.length} 个收藏？`)) {
                await db.items.bulkDelete(visibleSelected.map((i) => i.id))
                setSelected(new Set())
              }
            }}
          >
            删除
          </button>
          <button className="btn primary" disabled={!pending.length || batch.running || !settings.apiKey} onClick={() => setConfirmOpen(true)}>
            AI 生成详解{pending.length ? `（${pending.length}）` : ''}
          </button>
        </div>
      )}

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <div className="batch-confirm">
          <h3>批量生成详解</h3>
          <p>
            将为 <b>{pending.length}</b> 个{tab === 'word' ? '单词' : '语法'}生成详细讲解，每次请求合并 5 个，共约{' '}
            <b>{Math.ceil(pending.length / 5)}</b> 次请求。
            {visibleSelected.length > pending.length && `已有详解的 ${visibleSelected.length - pending.length} 个会自动跳过。`}
          </p>
          <button className="choice" onClick={() => start('fast')}>
            <b>经济模式</b>
            <span>
              用分析模型（{settings.model}），费用不到高质量模式的 1/20，讲解稍简略但够用
            </span>
          </button>
          <button className="choice" onClick={() => start('deep')}>
            <b>高质量模式</b>
            <span>用详解模型（{settings.deepModel}），与单独打开词条时生成的质量相同</span>
          </button>
          <p className="muted small">生成在后台进行，可以离开这个页面；生成的内容会保存到对应的单词 / 语法卡里。</p>
        </div>
      </Sheet>
    </div>
  )
}
