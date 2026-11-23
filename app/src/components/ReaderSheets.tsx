import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ensureAnalyzed, reanalyze } from '../lib/analysis'
import { db } from '../lib/db'
import { addFavorite, itemId, removeFavoriteSource, sameSource, seedFromGrammar, seedFromWord, type ItemSeed } from '../lib/favorites'
import { lookupWord } from '../lib/llm'
import { useSettings } from '../lib/settings'
import { jlptLevel } from '../lib/text'
import { resolveWord, type Chunk } from '../lib/tokenize'
import type { Analysis, GrammarInfo, Lang, Source, WordInfo } from '../lib/types'
import { Icon, JlptBadge, Spinner } from './ui'

interface Ctx {
  lang: Lang
  bookId: number
  p: number
  s: number
  sentence: string
  analysis?: Analysis
  pending: boolean
  error?: string
}

function makeSource(ctx: Ctx, surface?: string): Source {
  return {
    bookId: ctx.bookId,
    para: ctx.p,
    sent: ctx.s,
    lang: ctx.lang,
    text: ctx.sentence,
    translation: ctx.analysis?.translation,
    surface,
    at: Date.now(),
  }
}

function StarButton({ seed, source }: { seed: ItemSeed; source: Source }) {
  const item = useLiveQuery(() => db.items.get(itemId(seed.type, seed.key)), [seed.type, seed.key])
  const on = !!item?.sources.some((s) => sameSource(s, source))
  return (
    <button
      className={`star-btn ${on ? 'on' : ''}`}
      aria-label={on ? '取消收藏' : '收藏'}
      onClick={(e) => {
        e.stopPropagation()
        if (on) removeFavoriteSource(seed.type, seed.key, source)
        else addFavorite(seed, source)
      }}
    >
      <Icon name="star" filled={on} size={20} />
      <span>{on ? '已收藏' : '收藏'}</span>
    </button>
  )
}

function useItemNav() {
  const nav = useNavigate()
  return (seed: ItemSeed) => nav(`/item/${seed.type}/${encodeURIComponent(seed.key)}`, { state: seed })
}

function ErrorBox({ ctx }: { ctx: Ctx }) {
  return (
    <div className="error-box">
      <p>{ctx.error}</p>
      <button className="btn ghost" onClick={() => ensureAnalyzed(ctx.lang, [ctx.sentence], { urgent: true, retry: true })}>
        <Icon name="refresh" size={16} /> 重试
      </button>
    </div>
  )
}

export function WordSheet(props: Ctx & { chunk: Chunk; onShowSentence: () => void }) {
  const { chunk, lang, sentence, analysis, pending } = props
  const settings = useSettings()
  const openItem = useItemNav()
  const lookupId = `lookup:${lang}:${sentence}:${chunk.start}:${chunk.text}`
  const lookup = useLiveQuery(() => db.details.get(lookupId), [lookupId])
  const [lookupErr, setLookupErr] = useState('')
  const asked = useRef('')

  // The analysis did not cover this word: ask for it separately.
  const needLookup = !!analysis && !chunk.word && lookup === undefined
  useEffect(() => {
    if (!needLookup || !settings.apiKey || asked.current === lookupId) return
    asked.current = lookupId
    setLookupErr('')
    lookupWord(lang, sentence, chunk.text)
      .then(({ word, model }) => db.details.put({ id: lookupId, data: word, model, at: Date.now() }))
      .catch((e) => setLookupErr(e.message))
  }, [needLookup, settings.apiKey, lookupId, lang, sentence, chunk.text])

  const resolved = useMemo(() => {
    const c = !chunk.word && lookup ? { ...chunk, word: lookup.data as WordInfo } : chunk
    return resolveWord(lang, c)
  }, [chunk, lookup, lang])

  const seed = seedFromWord(resolved)
  const source = makeSource(props, chunk.text)
  const loading = !resolved.meaning && (pending || (needLookup && !lookupErr) || (!analysis && !props.error && !!settings.apiKey))

  return (
    <div className="word-sheet">
      {lang === 'zh' && (
        <div className="zh-source">
          中文：<strong>{chunk.text}</strong>
        </div>
      )}
      <div className="word-head">
        <div>
          {resolved.lemma ? (
            <>
              <div className="reading">{resolved.reading && resolved.reading !== resolved.lemma ? resolved.reading : ''}</div>
              <div className="headword" lang="ja">
                {resolved.lemma}
              </div>
            </>
          ) : (
            <div className="headword muted">…</div>
          )}
          {lang === 'ja' && resolved.surface !== resolved.lemma && (
            <div className="muted small" lang="ja">
              句中：{resolved.surface}
            </div>
          )}
        </div>
        {resolved.lemma && <StarButton seed={seed} source={source} />}
      </div>
      {resolved.pos && <span className="tag">{resolved.pos}</span>}

      <div className="meaning">
        {resolved.meaning ? (
          resolved.meaning
        ) : loading ? (
          <Spinner label="分析中…" />
        ) : props.error ? (
          <ErrorBox ctx={props} />
        ) : lookupErr ? (
          <span className="error">{lookupErr}</span>
        ) : !settings.apiKey ? (
          <span className="muted">填写 API Key 后显示释义</span>
        ) : null}
      </div>

      <div className="sheet-actions">
        <button className="btn ghost" onClick={props.onShowSentence}>
          整句翻译与语法
        </button>
        <button className="btn primary" disabled={!resolved.lemma} onClick={() => openItem(seed)}>
          详细释义 <Icon name="chevron" size={16} />
        </button>
      </div>
    </div>
  )
}

function GrammarRow({ g, ctx }: { g: GrammarInfo; ctx: Ctx }) {
  const openItem = useItemNav()
  const seed = seedFromGrammar(g)
  return (
    <li className="grammar-row" onClick={() => openItem(seed)}>
      <div className="grammar-main">
        <div className="grammar-pattern" lang="ja">
          {g.pattern} <JlptBadge jlpt={g.jlpt} />
        </div>
        <div className="grammar-meaning">{g.meaning}</div>
        {g.explanation && <div className="grammar-expl">{g.explanation}</div>}
      </div>
      <StarButton seed={seed} source={makeSource(ctx)} />
    </li>
  )
}

export function SentenceSheet(props: Ctx & { onListen: () => void }) {
  const { analysis, pending, lang, sentence } = props
  const settings = useSettings()
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (!analysis && settings.apiKey) ensureAnalyzed(lang, [sentence], { urgent: true })
  }, [analysis, settings.apiKey, lang, sentence])
  const grammar = analysis?.grammar ?? []
  const visible = grammar.filter((g) => {
    const lv = jlptLevel(g.jlpt)
    return showAll || lv == null || lv <= settings.minGrammarLevel
  })
  const hidden = grammar.length - visible.length

  return (
    <div className="sentence-sheet">
      <p className="orig" lang={lang === 'ja' ? 'ja' : 'zh-CN'}>
        {sentence}
      </p>
      <button className="btn ghost listen-btn" onClick={props.onListen}>
        <Icon name="headphones" size={18} /> 从这句开始听
      </button>
      {analysis ? (
        <>
          <div className="label">{lang === 'ja' ? '中文翻译' : '日语翻译'}</div>
          <p className="translation" lang={lang === 'ja' ? 'zh-CN' : 'ja'}>
            {analysis.translation}
          </p>
          <div className="label">
            语法
            {hidden > 0 && (
              <button className="link" onClick={() => setShowAll(true)}>
                显示 {hidden} 个较简单的语法
              </button>
            )}
          </div>
          {visible.length ? (
            <ul className="grammar-list">
              {visible.map((g, i) => (
                <GrammarRow key={i} g={g} ctx={props} />
              ))}
            </ul>
          ) : (
            <p className="muted">这句话没有需要特别注意的语法</p>
          )}
          <button className="link small" onClick={() => reanalyze(lang, sentence)}>
            <Icon name="refresh" size={14} /> 重新分析
          </button>
        </>
      ) : pending ? (
        <Spinner label="分析中…" />
      ) : props.error ? (
        <ErrorBox ctx={props} />
      ) : !settings.apiKey ? (
        <p className="muted">填写 API Key 后显示翻译和语法</p>
      ) : (
        <Spinner label="排队中…" />
      )}
    </div>
  )
}
