import { useRef, useState } from 'react'
import { TopBar } from '../components/ui'
import { exportAll, importAll } from '../lib/db'
import { testConnection } from '../lib/llm'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../lib/settings'

export default function SettingsPage() {
  const s = useSettings()
  const [showKey, setShowKey] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const text = (label: string, field: 'baseUrl' | 'model' | 'fallbackModel' | 'deepModel', hint?: string) => (
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
      </div>
    </div>
  )
}
