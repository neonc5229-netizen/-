import { useLiveQuery } from 'dexie-react-hooks'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PlayerBar from '../components/PlayerBar'
import { SentenceSheet, WordSheet } from '../components/ReaderSheets'
import { Icon, PromptDialog, Sheet, Spinner, TopBar } from '../components/ui'
import { analysisKey, ensureAnalyzed, useAnalyses, useAnalysisStatus } from '../lib/analysis'
import { db } from '../lib/db'
import { saveSettings, useSettings } from '../lib/settings'
import { chunkSentence, furiganaParts, getTokenizer, loadTokenizer, type Chunk } from '../lib/tokenize'
import { player, speakOnce, stopOnce, useOnce, usePlayer } from '../lib/tts'
import type { Analysis, Lang, Paragraph } from '../lib/types'

const PAGE_CHARS = 900

interface Page {
  start: number
  end: number // exclusive
}

function paginate(paras: Paragraph[] | undefined): Page[] {
  if (!paras?.length) return []
  const pages: Page[] = []
  let start = 0
  let chars = 0
  paras.forEach((p, i) => {
    chars += p.sentences.join('').length
    if (chars >= PAGE_CHARS) {
      pages.push({ start, end: i + 1 })
      start = i + 1
      chars = 0
    }
  })
  if (start < paras.length) pages.push({ start, end: paras.length })
  return pages
}

type Selection = { kind: 'word'; p: number; s: number; c: number } | { kind: 'sent'; p: number; s: number } | null

const SentenceView = memo(function SentenceView({
  lang,
  text,
  p,
  s,
  analysis,
  furigana,
  selectedChunk,
  selected,
  flash,
  speaking,
  marked,
  tokReady,
}: {
  lang: Lang
  text: string
  p: number
  s: number
  analysis?: Analysis
  furigana: boolean
  selectedChunk: number | null
  selected: boolean
  flash: boolean
  speaking: boolean
  marked: boolean
  tokReady: boolean
}) {
  const chunks = useMemo(
    () => chunkSentence(lang, text, analysis?.words),
    // tokReady: re-chunk once the dictionary has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, text, analysis, tokReady],
  )
  return (
    <span
      className={`sent ${selected ? 'selected' : ''} ${flash ? 'flash' : ''} ${speaking ? 'speaking' : ''} ${marked ? 'marked' : ''} ${analysis ? 'ready' : ''}`}
      data-p={p}
      data-s={s}
    >
      {chunks.map((c, i) =>
        c.punct ? (
          <span key={i}>{c.text}</span>
        ) : (
          <span key={i} data-c={i} className={`w ${selectedChunk === i ? 'active' : ''}`}>
            {furigana && lang === 'ja' && c.tokens.length ? <Ruby chunk={c} /> : c.text}
          </span>
        ),
      )}
    </span>
  )
})

function Ruby({ chunk }: { chunk: Chunk }) {
  return (
    <>
      {chunk.tokens.flatMap((t, ti) =>
        furiganaParts(t).map(([txt, rd], pi) =>
          rd ? (
            <ruby key={`${ti}-${pi}`}>
              {txt}
              <rt>{rd}</rt>
            </ruby>
          ) : (
            <span key={`${ti}-${pi}`}>{txt}</span>
          ),
        ),
      )}
    </>
  )
}

export default function Reader() {
  const { id } = useParams()
  const bookId = Number(id)
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const settings = useSettings()
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const paras = useLiveQuery(() => db.paragraphs.where('bookId').equals(bookId).sortBy('idx'), [bookId])
  const pages = useMemo(() => paginate(paras), [paras])
  const [page, setPage] = useState<number | null>(null)
  const [sel, setSel] = useState<Selection>(null)
  const [renaming, setRenaming] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [tokReady, setTokReady] = useState(!!getTokenizer())
  const [tokError, setTokError] = useState('')
  const articleRef = useRef<HTMLDivElement>(null)
  const status = useAnalysisStatus()
  const playerState = usePlayer()
  const onceState = useOnce()
  const lang = book?.lang

  const target = useMemo(() => {
    const p = sp.get('p')
    const s = sp.get('s')
    return p != null ? { p: Number(p), s: s != null ? Number(s) : null } : null
  }, [sp])

  useEffect(() => {
    loadTokenizer()
      .then(() => setTokReady(true))
      .catch((e) => setTokError(String(e?.message ?? e)))
  }, [])

  // Pick the starting page once the book is loaded (or when a jump target changes).
  // Without a jump target, resume at the exact sentence where reading stopped last time.
  const bookLoaded = !!book
  const progressPara = book?.progressPara ?? 0
  const progressSent = book?.progressSent ?? 0
  const initDone = useRef<string>('')
  const scrollTo = useRef<{ p: number; s: number; how: 'top' | 'center' } | null>(null)
  const [jumpTick, setJumpTick] = useState(0)
  useEffect(() => {
    if (!bookLoaded || !pages.length) return
    const sig = `${bookId}|${sp.toString()}`
    if (initDone.current === sig) return
    initDone.current = sig
    const at = target ? { p: target.p, s: target.s ?? 0 } : { p: progressPara, s: progressSent }
    const idx = Math.max(0, pages.findIndex((pg) => at.p >= pg.start && at.p < pg.end))
    if (target ? target.s != null : at.p > 0 || at.s > 0) scrollTo.current = { ...at, how: target ? 'center' : 'top' }
    setPage(idx)
    setJumpTick((t) => t + 1)
    db.books.update(bookId, { openedAt: Date.now() })
  }, [bookLoaded, pages, target, progressPara, progressSent, bookId, sp])

  // Save the reading position (sentence at the top of the screen) while scrolling.
  const lastSaved = useRef('')
  const savePosition = useCallback(
    (p: number, s: number, end: number) => {
      const sig = `${p}:${s}:${end}`
      if (sig === lastSaved.current) return
      lastSaved.current = sig
      db.books.update(bookId, { progressPara: p, progressSent: s, progressEnd: end })
    },
    [bookId],
  )
  const topSentence = useCallback(() => {
    const sents = articleRef.current?.querySelectorAll<HTMLElement>('.sent')
    if (!sents?.length) return null
    const headerH = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
    const viewBottom = window.innerHeight - (document.querySelector('.player-bar')?.getBoundingClientRect().height ?? 0)
    let first: HTMLElement | null = null
    let last: HTMLElement | null = null
    for (const el of sents) {
      const r = el.getBoundingClientRect()
      if (r.bottom > headerH + 4 && !first) first = el
      if (r.top < viewBottom) last = el
    }
    first ??= sents[0]
    last ??= first
    return { p: Number(first.dataset.p), s: Number(first.dataset.s), end: Number(last.dataset.p) }
  }, [])
  useEffect(() => {
    let timer = 0
    const onScroll = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const t = topSentence()
        if (t) savePosition(t.p, t.s, t.end)
      }, 300)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [topSentence, savePosition])

  // Stop reading aloud when leaving the book.
  useEffect(
    () => () => {
      player.close()
      stopOnce()
    },
    [],
  )
  useEffect(() => {
    if (paras) player.updateParas(paras)
  }, [paras])

  // Follow the sentence being read: turn the page and keep it in view.
  const speakPos = playerState.active ? playerState.pos : null
  useEffect(() => {
    if (!speakPos || !pages.length) return
    const idx = pages.findIndex((pg) => speakPos.p >= pg.start && speakPos.p < pg.end)
    if (idx >= 0 && idx !== page) {
      setSel(null)
      setPage(idx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakPos, pages])
  useEffect(() => {
    if (!speakPos) return
    const el = articleRef.current?.querySelector(`.sent[data-p="${speakPos.p}"][data-s="${speakPos.s}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    savePosition(speakPos.p, speakPos.s, speakPos.p)
  }, [speakPos, page, savePosition])

  const pg = page != null ? pages[page] : undefined
  const pageParas = useMemo(() => (pg && paras ? paras.slice(pg.start, pg.end) : []), [pg, paras])
  const pageSentences = useMemo(() => pageParas.flatMap((p) => p.sentences), [pageParas])
  const analyses = useAnalyses(lang, pageSentences)

  // Analyse the current page in the background, then prefetch the next one.
  useEffect(() => {
    if (!lang || !pageSentences.length || !settings.apiKey) return
    ensureAnalyzed(lang, pageSentences)
    const next = page != null ? pages[page + 1] : undefined
    if (next && paras) ensureAnalyzed(lang, paras.slice(next.start, next.end).flatMap((p) => p.sentences))
  }, [lang, pageSentences, settings.apiKey, page, pages, paras])

  // On page change: scroll to the resume / jump position if it is on this page, else to the top.
  useLayoutEffect(() => {
    if (page == null || !pg) return
    const to = scrollTo.current
    if (to && to.p >= pg.start && to.p < pg.end) {
      scrollTo.current = null
      const el = articleRef.current?.querySelector(`.sent[data-p="${to.p}"][data-s="${to.s}"]`)
      if (el) {
        if (to.how === 'center') el.scrollIntoView({ block: 'center' })
        else {
          const headerH = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0
          window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - headerH - 12)
        }
        return
      }
    }
    window.scrollTo(0, 0)
    const t = topSentence()
    if (t) savePosition(t.p, t.s, t.end)
  }, [page, pg, topSentence, savePosition, jumpTick])

  const jumpTo = (p: number, s: number) => {
    const idx = pages.findIndex((x) => p >= x.start && p < x.end)
    if (idx < 0) return
    scrollTo.current = { p, s, how: 'center' }
    setSel(null)
    setPage(idx)
    setJumpTick((t) => t + 1)
  }

  const bookmarks = useMemo(() => [...(book?.bookmarks ?? [])].sort((a, b) => a.p - b.p || a.s - b.s), [book?.bookmarks])
  const isBookmarked = (p: number, s: number) => bookmarks.some((b) => b.p === p && b.s === s)
  const toggleBookmark = (p: number, s: number) => {
    const list = book?.bookmarks ?? []
    const text = paras?.[p]?.sentences[s] ?? ''
    const next = isBookmarked(p, s) ? list.filter((b) => !(b.p === p && b.s === s)) : [...list, { p, s, text, at: Date.now() }]
    db.books.update(bookId, { bookmarks: next })
  }

  const goPage = (d: number) => {
    if (page == null) return
    const n = page + d
    if (n < 0 || n >= pages.length) return
    setSel(null)
    setPage(n)
  }

  // ---- touch handling: tap a word, long-press a sentence ----
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('.sent')
    if (!el) return
    const p = Number(el.dataset.p)
    const s = Number(el.dataset.s)
    const state = {
      x: e.clientX,
      y: e.clientY,
      fired: false,
      timer: window.setTimeout(() => {
        state.fired = true
        if (player.state.playing) player.pause()
        navigator.vibrate?.(12)
        setSel({ kind: 'sent', p, s })
      }, 450),
    }
    press.current = state
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const st = press.current
    if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) clearTimeout(st.timer)
  }
  const onClick = (e: React.MouseEvent) => {
    if (press.current?.fired) {
      press.current = null
      return
    }
    if (settings.tapAction === 'speak' && lang && paras) {
      const el = (e.target as Element).closest<HTMLElement>('.sent')
      if (!el) return
      const key = `${el.dataset.p}:${el.dataset.s}`
      if (onceState.key === key) return stopOnce()
      setSel(null)
      speakOnce(lang, paras[Number(el.dataset.p)].sentences[Number(el.dataset.s)], key, settings.sentenceRate)
      return
    }
    const w = (e.target as Element).closest<HTMLElement>('[data-c]')
    const sentEl = w?.closest<HTMLElement>('.sent')
    if (!w || !sentEl) {
      setSel(null)
      return
    }
    const p = Number(sentEl.dataset.p)
    const s = Number(sentEl.dataset.s)
    if (player.state.playing) player.pause()
    setSel({ kind: 'word', p, s, c: Number(w.dataset.c) })
    if (lang && settings.apiKey) ensureAnalyzed(lang, [paras![p].sentences[s]], { urgent: true })
  }

  const selText = sel && paras ? paras[sel.p]?.sentences[sel.s] : undefined
  const selAnalysis = selText && lang ? analyses.get(analysisKey(lang, selText)) : undefined
  const selChunk = useMemo(() => {
    if (!sel || sel.kind !== 'word' || !selText || !lang) return undefined
    return chunkSentence(lang, selText, selAnalysis?.words)[sel.c]
  }, [sel, selText, lang, selAnalysis])

  const closeSheet = useCallback(() => setSel(null), [])

  if (book === undefined || paras === undefined) {
    return (
      <div className="page center">
        <Spinner label="加载中" />
      </div>
    )
  }
  if (!book) {
    return (
      <div className="page center">
        <p>找不到这本书</p>
        <Link to="/">返回书库</Link>
      </div>
    )
  }

  const flashTarget = target && target.s != null ? target : null

  return (
    <div className={`page reader-page ${playerState.active ? 'with-player' : ''}`}>
      <TopBar
        title={book.title}
        onBack={() => nav('/')}
        onTitleClick={() => setRenaming(true)}
        right={
          <>
            <button
              className={`icon-btn ${playerState.active ? 'on' : ''}`}
              aria-label="听书"
              onClick={() => {
                if (playerState.active) return player.close()
                const start = sel ? { p: sel.p, s: sel.s } : { p: pg?.start ?? 0, s: 0 }
                player.open(book, paras, start)
                player.play()
              }}
            >
              <Icon name="headphones" />
            </button>
            <button className="icon-btn text" onClick={() => setViewOpen(true)} aria-label="阅读设置">
              Aa
            </button>
          </>
        }
      />

      {settings.tapAction === 'speak' && (
        <button className="mode-chip" onClick={() => saveSettings({ tapAction: 'lookup' })}>
          <Icon name="play" size={14} filled /> 点句朗读模式（{settings.sentenceRate}×）· 点此切回查词
        </button>
      )}
      {onceState.error && <div className="banner error">{onceState.error}</div>}
      {!settings.apiKey && (
        <Link to="/settings" className="banner">
          还没有填写 API Key，填写后才能显示翻译和释义 →
        </Link>
      )}
      {lang === 'ja' && !tokReady && !tokError && (
        <div className="banner muted">
          <Spinner label="正在加载日语词典（首次约 18MB，之后会缓存）" />
        </div>
      )}
      {tokError && <div className="banner error">词典加载失败：{tokError}</div>}

      <article
        ref={articleRef}
        className={`reader ${lang === 'ja' ? 'ja' : 'zh'} ${settings.furigana ? 'with-ruby' : ''}`}
        lang={lang === 'ja' ? 'ja' : 'zh-CN'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {pageParas.map((para) => (
          <p key={para.idx} className="para">
            {para.sentences.map((text, s) => {
              const a = analyses.get(analysisKey(book.lang, text))
              return (
                <SentenceView
                  key={s}
                  lang={book.lang}
                  text={text}
                  p={para.idx}
                  s={s}
                  analysis={a}
                  furigana={settings.furigana}
                  tokReady={tokReady}
                  selected={!!sel && sel.p === para.idx && sel.s === s}
                  selectedChunk={sel?.kind === 'word' && sel.p === para.idx && sel.s === s ? sel.c : null}
                  flash={!!flashTarget && flashTarget.p === para.idx && flashTarget.s === s}
                  speaking={(!!speakPos && speakPos.p === para.idx && speakPos.s === s) || onceState.key === `${para.idx}:${s}`}
                  marked={isBookmarked(para.idx, s)}
                />
              )
            })}
          </p>
        ))}
      </article>

      <footer className="pager">
        <button className="btn ghost" disabled={!page} onClick={() => goPage(-1)}>
          ‹ 上一页
        </button>
        <span className="muted">
          {(page ?? 0) + 1} / {pages.length}
        </span>
        <button className="btn ghost" disabled={page == null || page >= pages.length - 1} onClick={() => goPage(1)}>
          下一页 ›
        </button>
      </footer>

      <Sheet open={!!sel} onClose={closeSheet}>
        {sel && selText && lang && sel.kind === 'word' && selChunk && (
          <WordSheet
            lang={lang}
            bookId={bookId}
            p={sel.p}
            s={sel.s}
            sentence={selText}
            chunk={selChunk}
            analysis={selAnalysis}
            pending={status.isPending(analysisKey(lang, selText))}
            error={status.errorOf(analysisKey(lang, selText))}
            onShowSentence={() => setSel({ kind: 'sent', p: sel.p, s: sel.s })}
            speakKey={`${sel.p}:${sel.s}`}
          />
        )}
        {sel && selText && lang && sel.kind === 'sent' && (
          <SentenceSheet
            lang={lang}
            bookId={bookId}
            p={sel.p}
            s={sel.s}
            sentence={selText}
            analysis={selAnalysis}
            pending={status.isPending(analysisKey(lang, selText))}
            error={status.errorOf(analysisKey(lang, selText))}
            speakKey={`${sel.p}:${sel.s}`}
            bookmarked={isBookmarked(sel.p, sel.s)}
            onBookmark={() => toggleBookmark(sel.p, sel.s)}
            onListen={() => {
              player.open(book, paras, { p: sel.p, s: sel.s })
              player.seek({ p: sel.p, s: sel.s }, true)
              setSel(null)
            }}
          />
        )}
      </Sheet>

      <PlayerBar />

      <Sheet open={viewOpen} onClose={() => setViewOpen(false)}>
        <div className="view-settings">
          <div className="row">
            <span>字号</span>
            <div className="stepper">
              <button onClick={() => saveSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}>A-</button>
              <span>{settings.fontSize}</span>
              <button onClick={() => saveSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}>A+</button>
            </div>
          </div>
          <div className="row">
            <span>点击句子</span>
            <div className="segmented small inline">
              <button className={settings.tapAction === 'lookup' ? 'active' : ''} onClick={() => saveSettings({ tapAction: 'lookup' })}>
                查词
              </button>
              <button className={settings.tapAction === 'speak' ? 'active' : ''} onClick={() => saveSettings({ tapAction: 'speak' })}>
                朗读
              </button>
            </div>
          </div>
          {lang === 'ja' && (
            <label className="row">
              <span>显示假名注音</span>
              <input type="checkbox" className="switch" checked={settings.furigana} onChange={(e) => saveSettings({ furigana: e.target.checked })} />
            </label>
          )}
          <div className="row">
            <span>跳到第几页</span>
            <select className="input small" value={page ?? 0} onChange={(e) => (setSel(null), setPage(Number(e.target.value)))}>
              {pages.map((_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
          <div className="bookmark-section">
            <div className="row">
              <span>书签</span>
              <button
                className="btn ghost small-btn"
                onClick={() => {
                  const t = topSentence()
                  if (t && !isBookmarked(t.p, t.s)) toggleBookmark(t.p, t.s)
                }}
              >
                <Icon name="bookmark" size={16} /> 在当前位置加书签
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="muted small">还没有书签。也可以长按句子后点「加书签」。</p>
            ) : (
              <ul className="bookmark-list">
                {bookmarks.map((b) => (
                  <li key={`${b.p}-${b.s}`}>
                    <button
                      className="bookmark-jump"
                      onClick={() => {
                        setViewOpen(false)
                        jumpTo(b.p, b.s)
                      }}
                    >
                      <span className="bookmark-page">第 {pages.findIndex((x) => b.p >= x.start && b.p < x.end) + 1} 页</span>
                      <span className="bookmark-text" lang={lang === 'ja' ? 'ja' : 'zh-CN'}>
                        {b.text}
                      </span>
                    </button>
                    <button className="icon-btn" aria-label="删除书签" onClick={() => toggleBookmark(b.p, b.s)}>
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            className="btn ghost block"
            onClick={() => {
              if (lang) ensureAnalyzed(lang, pageSentences, { urgent: true, retry: true })
              setViewOpen(false)
            }}
          >
            <Icon name="refresh" size={18} /> 重试本页失败的分析
          </button>
        </div>
      </Sheet>

      <PromptDialog
        open={renaming}
        title="修改书名"
        initial={book.title}
        onClose={() => setRenaming(false)}
        onConfirm={async (v) => {
          await db.books.update(bookId, { title: v })
          setRenaming(false)
        }}
      />
    </div>
  )
}
