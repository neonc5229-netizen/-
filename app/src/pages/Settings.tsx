import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { TopBar } from '../components/ui'
import { db, exportAll, importAll } from '../lib/db'
import { testConnection } from '../lib/llm'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../lib/settings'
import { AI_VOICES, japaneseVoices, previewVoice, RATES } from '../lib/tts'

const SAMPLE = '彼の言い分を聞けば聞くほど、あながち間違っているとも言い切れなかった。'

function useJapaneseVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => japaneseVoices())
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const update = () => setVoices(japaneseVoices())
    speechSynthesis.addEventListener('voiceschanged', update)
    return () => speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

export default function SettingsPage() {
  const s = useSettings()
  const [showKey, setShowKey] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const voices = useJapaneseVoices()
  const [previewMsg, setPreviewMsg] = useState('')
  const audioCount = useLiveQuery(() => db.audio.count(), [], 0)

  const text = (label: string, field: 'baseUrl' | 'model' | 'fallbackModel' | 'deepModel' | 'ttsModel', hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        value={s[field]}
        placeholder={DEFAULT_SETTINGS[field]}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => saveSettings({ [field]: e.target.value.trim() })}
      />
      {hint && <em className="muted small">{hint}</em>}
    </label>
  )

  async function backup() {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `日语阅读备份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function restore(f?: File) {
    if (!f) return
    if (!confirm('恢复备份会覆盖当前所有书本和收藏，继续？')) return
    try {
      await importAll(JSON.parse(await f.text()))
      alert('恢复完成')
    } catch (e) {
      alert(`恢复失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="page with-nav">
      <TopBar title="设置" />
      <div className="form">
        <h3 className="section-title">AI 接口</h3>
        {text('接口地址', 'baseUrl')}
        <label className="field">
          <span>API Key</span>
          <div className="input-row">
            <input
              className="input"
              type={showKey ? 'text' : 'password'}
              value={s.apiKey}
              placeholder="sk-…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => saveSettings({ apiKey: e.target.value.trim() })}
            />
            <button className="btn ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <em className="muted small">只保存在本机浏览器中</em>
        </label>
        {text('分析模型', 'model', '用于逐句翻译、语法和释义，要求快且便宜')}
        {text('备用模型', 'fallbackModel', '分析模型出错时自动改用')}
        {text('详解模型', 'deepModel', '用于单词和语法的详细讲解')}
        <button
          className="btn ghost block"
          disabled={testing}
          onClick={async () => {
            setTesting(true)
            setTestMsg('')
            try {
              setTestMsg(`✓ 连接成功（${await testConnection()}）`)
            } catch (e) {
              setTestMsg(`✗ ${(e as Error).message}`)
            } finally {
              setTesting(false)
            }
          }}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {testMsg && <p className={testMsg.startsWith('✓') ? 'ok' : 'error'}>{testMsg}</p>}

        <h3 className="section-title">听书</h3>
        <div className="field">
          <span>声音</span>
          <div className="segmented small">
            <button className={s.ttsEngine === 'system' ? 'active' : ''} onClick={() => saveSettings({ ttsEngine: 'system' })}>
              系统语音（免费）
            </button>
            <button className={s.ttsEngine === 'ai' ? 'active' : ''} onClick={() => saveSettings({ ttsEngine: 'ai' })}>
              AI 语音（高品质）
            </button>
          </div>
          <em className="muted small">
            {s.ttsEngine === 'ai'
              ? '更自然，按量计费（约 $0.0016 / 句），生成过的句子会缓存在本机，重复听不再计费'
              : '免费、离线可用。iPhone 可在 设置 → 辅助功能 → 朗读内容 → 声音 → 日语 中下载“增强”音质的声音'}
          </em>
        </div>
        {s.ttsEngine === 'system' ? (
          <label className="field">
            <span>系统声音</span>
            <select className="input" value={s.systemVoice} onChange={(e) => saveSettings({ systemVoice: e.target.value })}>
              <option value="">默认日语声音</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
            {voices.length === 0 && <em className="muted small">没有找到日语声音，请在手机系统设置中添加日语朗读声音</em>}
          </label>
        ) : (
          <>
            <label className="field">
              <span>AI 声音</span>
              <select className="input" value={s.aiVoice} onChange={(e) => saveSettings({ aiVoice: e.target.value })}>
                {AI_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            {text('语音模型', 'ttsModel')}
          </>
        )}
        <label className="field">
          <span>语速</span>
          <select className="input" value={s.ttsRate} onChange={(e) => saveSettings({ ttsRate: Number(e.target.value) })}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn ghost block"
          onClick={async () => {
            setPreviewMsg(s.ttsEngine === 'ai' ? '生成中…' : '')
            try {
              await previewVoice(SAMPLE)
              setPreviewMsg('')
            } catch (e) {
              setPreviewMsg(`✗ ${(e as Error).message}`)
            }
          }}
        >
          试听
        </button>
        {previewMsg && <p className={previewMsg.startsWith('✗') ? 'error' : 'muted'}>{previewMsg}</p>}

        <h3 className="section-title">学习</h3>
        <label className="field">
          <span>显示的语法难度</span>
          <select className="input" value={s.minGrammarLevel} onChange={(e) => saveSettings({ minGrammarLevel: Number(e.target.value) })}>
            <option value={1}>只显示 N1</option>
            <option value={2}>N2 及以上</option>
            <option value={3}>N3 及以上（推荐）</option>
            <option value={4}>N4 及以上</option>
            <option value={5}>全部</option>
          </select>
        </label>

        <h3 className="section-title">数据</h3>
        <p className="muted small">所有书本、分析结果和收藏都保存在这台设备的浏览器里。建议定期备份。</p>
        <div className="input-row">
          <button className="btn ghost" onClick={backup}>
            导出备份
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            恢复备份
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} />
        </div>
        {audioCount > 0 && (
          <button
            className="btn ghost block"
            onClick={async () => {
              if (confirm(`删除已缓存的 ${audioCount} 段 AI 语音？之后再听需要重新生成。`)) await db.audio.clear()
            }}
          >
            清除 AI 语音缓存（{audioCount} 段）
          </button>
        )}
      </div>
    </div>
  )
}
