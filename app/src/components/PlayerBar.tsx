import { saveSettings, useSettings } from '../lib/settings'
import { player, RATES, usePlayer } from '../lib/tts'
import { Icon, Spinner } from './ui'

export default function PlayerBar() {
  const st = usePlayer()
  const settings = useSettings()
  if (!st.active) return null
  const rate = settings.ttsRate
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1

  return (
    <div className="player-bar" role="region" aria-label="听书">
      {st.error && <div className="player-error">{st.error}</div>}
      <div className="player-row">
        <button className="icon-btn" onClick={() => player.close()} aria-label="关闭听书">
          <Icon name="close" size={20} />
        </button>
        <button className="player-rate" onClick={() => saveSettings({ ttsRate: nextRate })} aria-label="语速">
          {rate}×
        </button>
        <div className="player-main">
          <button className="icon-btn" onClick={() => player.prev()} aria-label="上一句">
            <Icon name="skipBack" />
          </button>
          <button className="player-play" onClick={() => player.toggle()} aria-label={st.playing ? '暂停' : '播放'}>
            {st.playing && st.loading ? <span className="spinner light" /> : <Icon name={st.playing ? 'pause' : 'play'} size={26} filled />}
          </button>
          <button className="icon-btn" onClick={() => player.next()} aria-label="下一句">
            <Icon name="skipForward" />
          </button>
        </div>
        <span className="player-engine">{settings.ttsEngine === 'ai' ? 'AI 语音' : '系统语音'}</span>
      </div>
      {st.playing && st.loading && settings.ttsEngine === 'ai' && (
        <div className="player-hint">
          <Spinner label="正在生成语音…" />
        </div>
      )}
    </div>
  )
}
