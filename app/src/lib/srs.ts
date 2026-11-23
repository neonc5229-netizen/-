import type { SrsState } from './types'

export type Grade = 'again' | 'hard' | 'good' | 'easy'

const DAY = 86_400_000

/** SM-2 style scheduling. `stability` holds the interval in days, `difficulty` the ease factor. */
export function schedule(prev: SrsState | undefined, grade: Grade, now = Date.now()): SrsState {
  let ease = prev?.difficulty ?? 2.5
  let interval = prev?.stability ?? 0
  let reps = prev?.reps ?? 0
  let lapses = prev?.lapses ?? 0
  if (grade === 'again') {
    lapses += prev ? 1 : 0
    reps = 0
    ease = Math.max(1.3, ease - 0.2)
    return { due: now + 10 * 60_000, stability: 0, difficulty: ease, reps, lapses, last: now }
  }
  if (reps === 0) interval = grade === 'easy' ? 4 : grade === 'good' ? 1 : 0.5
  else if (reps === 1) interval = grade === 'easy' ? 7 : grade === 'good' ? 3 : 1.5
  else interval = Math.max(1, interval * (grade === 'hard' ? 1.2 : grade === 'good' ? ease : ease * 1.3))
  ease = Math.max(1.3, ease + (grade === 'hard' ? -0.15 : grade === 'easy' ? 0.15 : 0))
  return { due: now + interval * DAY, stability: interval, difficulty: ease, reps: reps + 1, lapses, last: now }
}

export const isDue = (s: SrsState | undefined, now = Date.now()) => !!s && s.due <= now

export function describeInterval(s: SrsState) {
  const d = (s.due - Date.now()) / DAY
  if (d < 1 / 24) return '10 分钟后'
  if (d < 1) return `${Math.round(d * 24)} 小时后`
  return `${Math.round(d)} 天后`
}
