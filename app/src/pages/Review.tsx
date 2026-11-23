import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet, Spinner, TopBar } from '../components/ui'
import { cancelCompareBatch, runCompareBatch, useCompareBatch, wordsWithoutGroup } from '../lib/compare'
import { db } from '../lib/db'
import { reviewCounts } from '../lib/review'
import { saveSettings, useSettings } from '../lib/settings'

export default function Review() {
  const nav = useNavigate()
  const settings = useSettings()
  const batch = useCompareBatch()
  const [genOpen, setGenOpen] = useState(false)
  const counts = useLiveQuery(reviewCounts, [], null)
  const groups = useLiveQuery(() => db.groups.orderBy('createdAt').reverse().toArray(), [], [])
  const missing = useLiveQuery(wordsWithoutGroup, [groups.length], [])
  const totalItems = useLiveQuery(() => db.items.count(), [], 0)

  const dueTotal = counts ? counts.dueWords + counts.dueGrammar + counts.newItems + counts.dueGroups : 0

  return (
    <div className="page with-nav">
      <TopBar title="复习" />

      {totalItems === 0 ? (
        <div className="empty">
          <p>还没有收藏的单词或语法</p>
          <p className="muted small">阅读时收藏单词和语法后，就可以在这里复习</p>
        </div>
      ) : (
        <>
          <section className="review-hero">
            <div className="stats">
              <div className="stat">
                <b>{counts ? counts.dueWords + counts.dueGrammar : '–'}</b>
                <span>待复习</span>
              </div>
              <div className="stat">
                <b>{counts?.newItems ?? '–'}</b>
                <span>今日新词</span>
              </div>
              <div className="stat">
                <b>{counts?.dueGroups ?? '–'}</b>
                <span>辨析组</span>
              </div>
            </div>
            <button className="btn primary block big" disabled={!dueTotal} onClick={() => nav('/review/session?mode=daily')}>
              {dueTotal ? `开始今日复习（${dueTotal}）` : '今天的复习都完成了 🎉'}
            </button>
            <p className="muted small center-text">题型：选择意思 · 选择单词 · 原文填空 · 拼写{settings.reviewWriting ? ' · 造句（AI 批改）' : ''} · 相似词辨析</p>
          </section>

          <section className="card">
            <h3>
              相似词辨析
              <span className="muted small">{groups.length} 组</span>
            </h3>
            <p className="muted small">
              把意思相近或字形相似的词放在一起对比，例如 萎れる・萎びる・萎む・萎える。AI 会为收藏的单词找出容易混淆的词，并出填空题。
            </p>

            {(batch.running || batch.total > 0) && (
              <div className={`batch-banner ${batch.running ? '' : batch.failed ? 'warn' : 'ok'}`}>
                {batch.running ? (
                  <>
                    <Spinner label={`正在生成辨析组 ${batch.done + batch.failed} / ${batch.total}`} />
                    <button className="link small" onClick={cancelCompareBatch}>
                      停止
                    </button>
                  </>
                ) : (
                  <span>
                    已处理 {batch.done} 个单词{batch.failed ? `，${batch.failed} 个失败${batch.error ? `（${batch.error}）` : ''}` : ''}
                  </span>
                )}
              </div>
            )}

            <div className="btn-row">
              <button className="btn ghost" disabled={!groups.length} onClick={() => nav('/review/session?mode=compare')}>
                只练辨析{counts?.dueGroups ? `（${counts.dueGroups}）` : ''}
              </button>
              <button className="btn ghost" disabled={!missing.length || batch.running || !settings.apiKey} onClick={() => setGenOpen(true)}>
                为收藏生成辨析组{missing.length ? `（${missing.length}）` : ''}
              </button>
            </div>

            {groups.length > 0 && (
              <ul className="group-list">
                {groups.map((g) => (
                  <li key={g.id} onClick={() => nav(`/compare/${encodeURIComponent(g.id)}`)}>
                    <div className="group-words" lang="ja">
                      {g.words.map((w) => w.word).join('・')}
                    </div>
                    <div className="muted small">
                      {g.kind && <span className="tag inline">{g.kind}</span>} {g.theme}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h3>复习设置</h3>
            <label className="row-line">
              <span>每天新词数量</span>
              <select className="input small" value={settings.newPerDay} onChange={(e) => saveSettings({ newPerDay: Number(e.target.value) })}>
                {[5, 10, 20, 30, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="row-line">
              <span>包含造句题（AI 批改，每题约 $0.0001）</span>
              <input type="checkbox" className="switch" checked={settings.reviewWriting} onChange={(e) => saveSettings({ reviewWriting: e.target.checked })} />
            </label>
          </section>
        </>
      )}

      <Sheet open={genOpen} onClose={() => setGenOpen(false)}>
        <div className="batch-confirm">
          <h3>生成相似词辨析组</h3>
          <p>
            将为 <b>{missing.length}</b> 个还没有辨析组的收藏单词生成辨析组，每次请求处理 3 个词。如果几个收藏词属于同一组，会自动合并。
          </p>
          <button
            className="choice"
            onClick={() => {
              setGenOpen(false)
              runCompareBatch('fast')
            }}
          >
            <b>经济模式</b>
            <span>用分析模型（{settings.model}），费用很低</span>
          </button>
          <button
            className="choice"
            onClick={() => {
              setGenOpen(false)
              runCompareBatch('deep')
            }}
          >
            <b>高质量模式（推荐）</b>
            <span>用详解模型（{settings.deepModel}），辨析更准确细致，每组约 $0.003</span>
          </button>
        </div>
      </Sheet>
    </div>
  )
}
