import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { JlptBadge, Spinner, TopBar } from '../components/ui'
import { gradeSentence, type WritingGrade } from '../lib/llm'
import { applyGrade, buildSession, checkSpelling, QUESTION_LABEL, retryCard, type Card, type SessionMode } from '../lib/review'
import type { Grade } from '../lib/srs'
import type { Item } from '../lib/types'

type Phase = 'ask' | 'checking' | 'feedback'

function ItemFeedback({ item }: { item: Item }) {
  const src = item.sources[0]
  return (
    <div className="fb-item">
      <div className="fb-head" lang="ja">
        <span className="hw">{item.headword}</span>
        {item.reading && item.reading !== item.headword && <span className="rd">{item.reading}</span>}
        <JlptBadge jlpt={item.jlpt} />
      </div>
      <p className="fb-meaning">{item.meaning}</p>
      {src && (
        <div className="fb-source">
          <p lang={src.lang === 'ja' ? 'ja' : 'zh-CN'}>{src.text}</p>
          {src.translation && <p className="muted">{src.translation}</p>}
        </div>
      )}
    </div>
  )
}

export default function ReviewSession() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [cards, setCards] = useState<Card[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('ask')
  const [picked, setPicked] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [correct, setCorrect] = useState<boolean | null>(null)
  const [writing, setWriting] = useState<WritingGrade | null>(null)
  const [writeErr, setWriteErr] = useState('')
  const [showTrans, setShowTrans] = useState(false)
  const [stats, setStats] = useState({ right: 0, wrong: 0 })
  const requeued = useRef(new Map<string, number>())
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    const group = sp.get('group')
    const mode: SessionMode = group ? { kind: 'group', id: group } : sp.get('mode') === 'compare' ? { kind: 'compare' } : { kind: 'daily' }
    buildSession(mode).then(setCards)
  }, [sp])

  const card = cards?.[idx]
  const q = card?.question

  useEffect(() => {
    if (q && (q.kind === 'spell' || q.kind === 'write')) setTimeout(() => inputRef.current?.focus(), 100)
  }, [q])

  if (!cards)
    return (
      <div className="page center">
        <Spinner label="准备题目…" />
      </div>
    )

  if (!card || !q) {
    return (
      <div className="page">
        <TopBar title="复习" onBack={() => nav('/review')} />
        <div className="empty">
          <p className="big-emoji">{cards.length ? '🎉' : '✓'}</p>
          <p>{cards.length ? '本轮复习完成' : '现在没有需要复习的内容'}</p>
          {cards.length > 0 && (
            <p className="muted">
              答对 {stats.right} · 答错 {stats.wrong}
            </p>
          )}
          <button className="btn primary" onClick={() => nav('/review')}>
            返回
          </button>
        </div>
      </div>
    )
  }

  const choose = (i: number) => {
    if (phase !== 'ask' || !('options' in q)) return
    setPicked(i)
    const ok = i === q.answer
    setCorrect(ok)
    setPhase('feedback')
  }

  const submitSpell = () => {
    if (q.kind !== 'spell' || !input.trim()) return
    setCorrect(checkSpelling(q.item, input))
    setPhase('feedback')
  }

  const submitWrite = async () => {
    if (q.kind !== 'write' || !input.trim()) return
    setPhase('checking')
    setWriteErr('')
    try {
      const g = await gradeSentence({ type: q.item.type, headword: q.item.headword, meaning: q.item.meaning }, input.trim())
      setWriting(g)
      setCorrect(g.score >= 3)
      setPhase('feedback')
    } catch (e) {
      setWriteErr((e as Error).message)
      setPhase('ask')
    }
  }

  const next = async (grade: Grade) => {
    await applyGrade(card, grade)
    if (grade === 'again') {
      const key = card.target.id
      const n = requeued.current.get(key) ?? 0
      if (n < 2) {
        requeued.current.set(key, n + 1)
        const again = await retryCard(card)
        setCards((cs) => [...cs!, again])
      }
    }
    setStats((s) => (grade === 'again' ? { ...s, wrong: s.wrong + 1 } : { ...s, right: s.right + 1 }))
    setIdx((i) => i + 1)
    setPhase('ask')
    setPicked(null)
    setInput('')
    setCorrect(null)
    setWriting(null)
    setShowTrans(false)
  }

  const gradeButtons = () => {
    if (q.kind === 'flash')
      return (
        <div className="grade-row four">
          <button className="g-again" onClick={() => next('again')}>忘了</button>
          <button className="g-hard" onClick={() => next('hard')}>模糊</button>
          <button className="g-good" onClick={() => next('good')}>记得</button>
          <button className="g-easy" onClick={() => next('easy')}>简单</button>
        </div>
      )
    if (!correct)
      return (
        <div className="grade-row">
          <button className="g-again wide" onClick={() => next('again')}>
            记住了，继续（稍后再考）
          </button>
        </div>
      )
    const hardOnly = q.kind === 'write' && writing && writing.score === 3
    return (
      <div className="grade-row">
        <button className="g-hard" onClick={() => next('hard')}>模糊</button>
        {!hardOnly && <button className="g-good" onClick={() => next('good')}>记得</button>}
        {!hardOnly && <button className="g-easy" onClick={() => next('easy')}>简单</button>}
      </div>
    )
  }

  const optionClass = (i: number) => {
    if (phase !== 'feedback' || !('options' in q)) return ''
    if (i === q.answer) return 'right'
    if (i === picked) return 'wrong'
    return 'dim'
  }

  const options =
    'options' in q ? (
      <div className="options">
        {q.options.map((o, i) => (
          <button key={i} className={`option ${optionClass(i)}`} onClick={() => choose(i)} lang={q.kind === 'meaning' ? 'zh-CN' : 'ja'}>
            {o}
          </button>
        ))}
      </div>
    ) : null

  const item = q.kind === 'compare' ? null : q.item
  const progress = Math.round((idx / cards.length) * 100)

  return (
    <div className="page review-page">
      <TopBar title={`${idx + 1} / ${cards.length}`} onBack={() => nav('/review')} />
      <div className="progress big">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="q-meta">
        <span className="tag">{QUESTION_LABEL[q.kind]}</span>
        {card.isNew && <span className="tag new">新</span>}
        {item && <span className="muted small">{item.type === 'word' ? '单词' : '语法'}</span>}
      </div>

      {/* ----- prompt ----- */}
      {q.kind === 'meaning' && (
        <div className="prompt">
          <div className="prompt-word" lang="ja">
            {q.item.headword}
          </div>
          {phase === 'feedback' && q.item.reading && <div className="reading">{q.item.reading}</div>}
          <p className="muted small">选择正确的意思</p>
        </div>
      )}
      {q.kind === 'word' && (
        <div className="prompt">
          <div className="prompt-meaning">{q.item.meaning}</div>
          <p className="muted small">选择对应的{q.item.type === 'word' ? '单词' : '语法'}</p>
        </div>
      )}
      {q.kind === 'cloze' && (
        <div className="prompt">
          <p className="cloze" lang="ja">
            {q.before}
            <span className="blank">{phase === 'feedback' ? (q.source.surface ?? q.item.headword) : '　？　'}</span>
            {q.after}
          </p>
          {q.source.translation && <p className="muted small">{q.source.translation}</p>}
          <p className="muted small">选择填入空格的{q.item.type === 'word' ? '单词（原形）' : '语法'}</p>
        </div>
      )}
      {q.kind === 'spell' && (
        <div className="prompt">
          <div className="prompt-meaning">{q.item.meaning}</div>
          {q.source && (
            <>
              <p className="cloze" lang="ja">
                {q.source.before}
                <span className="blank">　？　</span>
                {q.source.after}
              </p>
              {q.source.translation && <p className="muted small">{q.source.translation}</p>}
            </>
          )}
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault()
              submitSpell()
            }}
          >
            <input
              ref={inputRef}
              className={`input ${phase === 'feedback' ? (correct ? 'ok-border' : 'err-border') : ''}`}
              placeholder="输入单词（假名或汉字，原形）"
              value={input}
              disabled={phase !== 'ask'}
              lang="ja"
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setInput(e.target.value)}
            />
            {phase === 'ask' && (
              <button className="btn primary" type="submit">
                确定
              </button>
            )}
          </form>
        </div>
      )}
      {q.kind === 'write' && (
        <div className="prompt">
          <div className="prompt-word" lang="ja">
            {q.item.headword}
          </div>
          <p className="muted">{q.item.meaning}</p>
          <p className="muted small">用这个{q.item.type === 'word' ? '单词' : '语法'}造一个日语句子，AI 会批改</p>
          <textarea
            ref={inputRef}
            className="input write-area"
            lang="ja"
            value={input}
            disabled={phase !== 'ask'}
            onChange={(e) => setInput(e.target.value)}
            placeholder="在这里输入句子…"
          />
          {writeErr && <p className="error small">{writeErr}</p>}
          {phase === 'ask' && (
            <div className="btn-row">
              <button className="btn ghost" onClick={() => (setCorrect(false), setPhase('feedback'))}>
                不会，跳过
              </button>
              <button className="btn primary" disabled={!input.trim()} onClick={submitWrite}>
                提交批改
              </button>
            </div>
          )}
          {phase === 'checking' && <Spinner label="AI 批改中…" />}
        </div>
      )}
      {q.kind === 'flash' && (
        <div className="prompt">
          <div className="prompt-word" lang="ja">
            {q.item.headword}
          </div>
          <p className="muted small">回想读音和意思，然后显示答案</p>
          {phase === 'ask' && (
            <button className="btn primary block" onClick={() => setPhase('feedback')}>
              显示答案
            </button>
          )}
        </div>
      )}
      {q.kind === 'compare' && (
        <div className="prompt">
          <p className="cloze" lang="ja">
            {phase === 'feedback' ? q.quiz.filled || q.quiz.sentence.replace(/＿+/, `【${q.quiz.answer}】`) : q.quiz.sentence.replace(/＿+/, '＿＿＿')}
          </p>
          {(showTrans || phase === 'feedback') && <p className="muted small">{q.quiz.translation}</p>}
          {phase === 'ask' && (
            <button className="link small" onClick={() => setShowTrans(true)}>
              显示中文翻译
            </button>
          )}
          <p className="muted small">选择最合适的词（按需活用）</p>
        </div>
      )}

      {options}

      {/* ----- feedback ----- */}
      {phase === 'feedback' && (
        <div className="feedback">
          {q.kind !== 'flash' && (
            <div className={`verdict ${correct ? 'ok' : 'bad'}`}>{correct ? '✓ 正确' : q.kind === 'write' && !writing ? '已跳过' : '✗ 不对'}</div>
          )}
          {q.kind === 'spell' && !correct && (
            <p>
              正确答案：<b lang="ja">{q.item.headword}</b>
              {q.item.reading && `（${q.item.reading}）`}
            </p>
          )}
          {q.kind === 'write' && writing && (
            <div className="write-result">
              <div className="score">评分 {'★'.repeat(writing.score)}{'☆'.repeat(5 - writing.score)}</div>
              {writing.corrected && writing.corrected !== input.trim() && (
                <p>
                  修改：<span lang="ja">{writing.corrected}</span>
                </p>
              )}
              <p className="muted">{writing.comment}</p>
            </div>
          )}
          {q.kind === 'compare' ? (
            <div className="fb-compare">
              <p>{q.quiz.explain}</p>
              <table className="cmp-table">
                <tbody>
                  {q.group.words.map((w) => (
                    <tr key={w.word} className={w.word === q.quiz.answer ? 'hl' : ''}>
                      <td lang="ja">
                        <b>{w.word}</b>
                        <div className="muted small">{w.reading}</div>
                      </td>
                      <td>{w.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="link small" onClick={() => nav(`/compare/${encodeURIComponent(q.group.id)}`)}>
                查看完整辨析 ›
              </button>
            </div>
          ) : (
            item && <ItemFeedback item={item} />
          )}
          {gradeButtons()}
        </div>
      )}
    </div>
  )
}
