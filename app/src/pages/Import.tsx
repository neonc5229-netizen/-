import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, TopBar } from '../components/ui'
import { db } from '../lib/db'
import { detectLang, readFileText, splitParagraphs } from '../lib/text'
import type { Lang } from '../lib/types'

export default function Import() {
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [lang, setLang] = useState<Lang | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const paragraphs = useMemo(() => (text.trim() ? splitParagraphs(text) : []), [text])
  const detected = useMemo(() => (text.trim() ? detectLang(text) : null), [text])
  const effectiveLang = lang ?? detected ?? 'ja'
  const charCount = paragraphs.reduce((n, p) => n + p.join('').length, 0)

  const defaultTitle = () => {
    if (fileName) return fileName.replace(/\.(txt|docx)$/i, '')
    const first = paragraphs[0]?.join('') ?? ''
    return first.slice(0, 16) || '未命名'
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setError('')
    if (!/\.(txt|docx)$/i.test(f.name)) {
      setError('只支持 .txt 和 .docx 文件')
      return
    }
    setBusy(true)
    try {
      setText(await readFileText(f))
      setFileName(f.name)
      setTitle(f.name.replace(/\.(txt|docx)$/i, ''))
      setLang(null)
    } catch (e) {
      setError(`读取失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!paragraphs.length) return
    setBusy(true)
    const now = Date.now()
    const bookId = await db.transaction('rw', db.books, db.paragraphs, async () => {
      const id = (await db.books.add({
        title: title.trim() || defaultTitle(),
        lang: effectiveLang,
        createdAt: now,
        openedAt: now,
        paraCount: paragraphs.length,
        charCount,
        progressPara: 0,
      })) as number
      await db.paragraphs.bulkAdd(paragraphs.map((sentences, idx) => ({ bookId: id, idx, sentences })))
      return id
    })
    nav(`/book/${bookId}`, { replace: true })
  }

  return (
    <div className="page">
      <TopBar title="导入文本" onBack={() => nav(-1)} />
      <div className="segmented">
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
          <Icon name="file" size={18} /> 文件
        </button>
        <button className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}>
          <Icon name="paste" size={18} /> 粘贴文本
        </button>
      </div>

      <div className="form">
        {mode === 'file' ? (
          <>
            <input ref={fileRef} type="file" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="dropzone" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="file" size={30} />
              <span>{fileName || '选择 .txt 或 .docx 文件'}</span>
            </button>
          </>
        ) : (
          <textarea
            className="input textarea"
            placeholder="把小说或文章粘贴到这里…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setFileName('')
            }}
          />
        )}

        {error && <p className="error">{error}</p>}

        {paragraphs.length > 0 && (
          <>
            <label className="field">
              <span>书名</span>
              <input className="input" value={title} placeholder={defaultTitle()} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="field">
              <span>
                语言 {detected && <em className="muted">（自动识别为{detected === 'ja' ? '日语' : '中文'}）</em>}
              </span>
              <div className="segmented small">
                <button className={effectiveLang === 'ja' ? 'active' : ''} onClick={() => setLang('ja')}>
                  日语 → 日译中
                </button>
                <button className={effectiveLang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>
                  中文 → 中译日
                </button>
              </div>
            </div>
            <div className="preview">
              <div className="muted">
                {paragraphs.length} 段 · {charCount.toLocaleString()} 字
              </div>
              {paragraphs.slice(0, 3).map((p, i) => (
                <p key={i}>{p.join('')}</p>
              ))}
            </div>
            <button className="btn primary block" onClick={save} disabled={busy}>
              保存到{effectiveLang === 'ja' ? '日语' : '中文'}书库并开始阅读
            </button>
          </>
        )}
      </div>
    </div>
  )
}
