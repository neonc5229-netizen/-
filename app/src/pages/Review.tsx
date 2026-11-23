import { useLiveQuery } from 'dexie-react-hooks'
import { TopBar } from '../components/ui'
import { db } from '../lib/db'

export default function Review() {
  const words = useLiveQuery(() => db.items.where('type').equals('word').count(), [], 0)
  const grammar = useLiveQuery(() => db.items.where('type').equals('grammar').count(), [], 0)
  return (
    <div className="page with-nav">
      <TopBar title="复习" />
      <div className="stats">
        <div className="stat">
          <b>{words}</b>
          <span>收藏单词</span>
        </div>
        <div className="stat">
          <b>{grammar}</b>
          <span>收藏语法</span>
        </div>
      </div>
      <div className="empty">
        <p>复习功能将在第二阶段加入</p>
        <p className="muted small">选择题、拼写、挖空填词、造句（AI 批改），按间隔重复算法安排每日复习。</p>
      </div>
    </div>
  )
}
