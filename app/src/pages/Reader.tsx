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
import { player, usePlayer } from '../lib/tts'
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
      className={`sent ${selected ? 'selected' : ''} ${flash ? 'flash' : ''} ${speaking ? 'speaking' : ''} ${analysis ? 'ready' : ''}`}
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
  const bookLoaded = !!book
  const progressPara = book?.progressPara ?? 0
  const initDone = useRef<string>('')
  useEffect(() => {
    if (!bookLoaded || !pages.length) return
    const sig = `${bookId}|${sp.toString()}`
    if (initDone.current === sig) return
    initDone.current = sig
    const para = target ? target.p : progressPara
    const idx = Math.max(0, pages.findIndex((pg) => para >= pg.start && para < pg.end))
    setPage(idx)
  }, [bookLoaded, pages, target, progressPara, bookId, sp])

  // Save reading progress.
  useEffect(() => {
    if (page == null || !pages[page]) return
    db.books.update(bookId, { progressPara: pages[page].start, progressEnd: pages[page].end - 1, openedAt: Date.now() })
  }, [page, pages, bookId])

  // Stop reading aloud when leaving the book.
  useEffect(() => () => player.close(), [])
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
  }, [speakPos, page])

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

  // Scroll to top on page change, or to the jump target.
  useLayoutEffect(() => {
    if (page == null) return
    if (target && target.s != null && pg && target.p >= pg.start && target.p < pg.end) {
      const el = articleRef.current?.querySelector(`.sent[data-p="${target.p}"][data-s="${target.s}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        return
      }
    }
    window.scrollTo(0, 0)
  }, [page, pg, target, tokReady])

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
                  speaking={!!speakPos && speakPos.p === para.idx && speakPos.s === s}
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
