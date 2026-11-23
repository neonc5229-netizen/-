import { useSyncExternalStore } from 'react'
import { analysisKey, ensureAnalyzed, getAnalysisError } from './analysis'
import { db } from './db'
import { getSettings } from './settings'
import type { Lang, Paragraph } from './types'

export interface PlayerPos {
  p: number
  s: number
}

export interface PlayerState {
  /** Player bar is shown. */
  active: boolean
  playing: boolean
  /** Waiting for audio (AI speech generation or a translation). */
  loading: boolean
  pos: PlayerPos | null
  error: string
}

export const AI_VOICES: { id: string; label: string }[] = [
  { id: 'Kore', label: 'Kore · 女声，沉稳清晰' },
  { id: 'Aoede', label: 'Aoede · 女声，轻快' },
  { id: 'Leda', label: 'Leda · 女声，年轻' },
  { id: 'Zephyr', label: 'Zephyr · 女声，明亮' },
  { id: 'Charon', label: 'Charon · 男声，低沉叙述' },
  { id: 'Orus', label: 'Orus · 男声，稳重' },
  { id: 'Puck', label: 'Puck · 男声，活泼' },
  { id: 'Fenrir', label: 'Fenrir · 男声，有力' },
]

export const RATES = [0.5, 0.8, 1, 1.2]

const hasSpeakable = (t: string) => /[\p{L}\p{N}]/u.test(t)

// ---------- system voices ----------

export function japaneseVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis.getVoices().filter((v) => /^ja(-|_|$)/i.test(v.lang))
}

function pickSystemVoice() {
  const voices = japaneseVoices()
  const want = getSettings().systemVoice
  return voices.find((v) => v.voiceURI === want) ?? voices.find((v) => v.localService) ?? voices[0]
}

function speakSystem(text: string, rate: number, isCancelled: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    if (typeof speechSynthesis === 'undefined') return reject(new Error('这个浏览器不支持系统朗读'))
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    const v = pickSystemVoice()
    try {
      if (v) u.voice = v
    } catch {
      /* fall back to the default voice for ja-JP */
    }
    u.rate = rate
    // Keep a reference so the utterance is not garbage-collected before `end` fires (Chrome bug).
    ;(window as unknown as { __utt?: SpeechSynthesisUtterance }).__utt = u
    u.onend = () => resolve()
    u.onerror = (e) => {
      if (isCancelled() || e.error === 'interrupted' || e.error === 'canceled') resolve()
      else reject(new Error(`系统朗读出错：${e.error}`))
    }
    speechSynthesis.speak(u)
  })
}

// ---------- AI voices ----------

function pcmToWav(pcm: Uint8Array, sampleRate: number) {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, pcm.length, true)
  return new Blob([header, pcm as BlobPart], { type: 'audio/wav' })
}

const clipInflight = new Map<string, Promise<Blob>>()

async function fetchAiClip(text: string, model: string, voice: string): Promise<Blob> {
  const s = getSettings()
  if (!s.apiKey) throw new Error('AI 语音需要先在「设置」中填写 API Key')
  const root = s.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${root}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    })
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        msg += ' ' + ((await res.json())?.error?.message ?? '')
      } catch {
        /* ignore */
      }
      lastErr = msg
      if (res.status >= 500 || res.status === 429) continue
      break
    }
    const j = await res.json()
    const part = j?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData
    if (!part?.data) {
      lastErr = '没有返回音频'
      continue
    }
    const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0))
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1] ?? 24000)
    return /wav|mpeg|mp3|ogg/.test(part.mimeType ?? '') ? new Blob([bytes], { type: part.mimeType }) : pcmToWav(bytes, rate)
  }
  throw new Error(`AI 语音生成失败：${lastErr}`)
}

export function getAiClip(text: string): Promise<Blob> {
  const { ttsModel, aiVoice } = getSettings()
  const key = `${ttsModel}|${aiVoice}|${text}`
  let p = clipInflight.get(key)
  if (!p) {
    p = (async () => {
      const cached = await db.audio.get(key)
      if (cached) return cached.blob
      const blob = await fetchAiClip(text, ttsModel, aiVoice)
      await db.audio.put({ key, blob, at: Date.now() })
      return blob
    })().finally(() => clipInflight.delete(key))
    clipInflight.set(key, p)
  }
  return p
}

/** The Japanese text to read for a sentence: itself, or (for Chinese books) its Japanese translation. */
export async function japaneseTextFor(lang: Lang, sentence: string, isCancelled: () => boolean): Promise<string> {
  if (lang === 'ja' || !hasSpeakable(sentence)) return sentence
  const key = analysisKey(lang, sentence)
  for (let i = 0; i < 240; i++) {
    const a = await db.analyses.get(key)
    if (a) return a.translation
    if (i === 0) await ensureAnalyzed(lang, [sentence], { urgent: true, retry: true })
    const err = getAnalysisError(key)
    if (err && i > 0) throw new Error(err)
    if (isCancelled()) return ''
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('等待日语译文超时')
}

// A tiny silent WAV, played inside the user's tap so iOS lets the element play later on its own.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

// ---------- player ----------

class Player {
  state: PlayerState = { active: false, playing: false, loading: false, pos: null, error: '' }
  private listeners = new Set<() => void>()
  private token = 0
  private lang: Lang = 'ja'
  private paras: Paragraph[] = []
  private title = ''
  private audio: HTMLAudioElement | null = null
  private unlocked = false

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
    this.updateMediaSession()
  }

  private el() {
    if (!this.audio) {
      this.audio = new Audio()
      this.audio.preload = 'auto'
    }
    return this.audio
  }

  /** Shows the player for a book, positioned at `start` (does not start playing). */
  open(book: { lang: Lang; title: string }, paras: Paragraph[], start: PlayerPos) {
    this.lang = book.lang
    this.title = book.title
    this.paras = paras
    if (!this.state.active) this.set({ active: true, pos: start, error: '' })
    this.setupMediaSession()
  }

  updateParas(paras: Paragraph[]) {
    this.paras = paras
  }

  play() {
    if (!this.state.pos) return
    stopOnce()
    if (!this.unlocked && getSettings().ttsEngine === 'ai') {
      const a = this.el()
      a.src = SILENT_WAV
      a.play().catch(() => {})
      this.unlocked = true
    }
    const tok = ++this.token
    this.set({ playing: true, error: '' })
    this.loop(tok)
  }

  pause() {
    this.token++
    this.halt()
    this.set({ playing: false, loading: false })
  }

  toggle() {
    if (this.state.playing) this.pause()
    else this.play()
  }

  /** Jumps to a sentence, keeping the play/pause state. */
  seek(pos: PlayerPos, autoplay = this.state.playing) {
    this.token++
    this.halt()
    this.set({ pos, loading: false })
    if (autoplay) this.play()
    else this.set({ playing: false })
  }

  next() {
    const n = this.state.pos && this.after(this.state.pos)
    if (n) this.seek(n)
  }

  prev() {
    const n = this.state.pos && this.before(this.state.pos)
    if (n) this.seek(n)
  }

  close() {
    this.token++
    this.halt()
    this.set({ active: false, playing: false, loading: false, pos: null, error: '' })
  }

  private halt() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    if (this.audio) this.audio.pause()
  }

  private after({ p, s }: PlayerPos): PlayerPos | null {
    if (this.paras[p] && s + 1 < this.paras[p].sentences.length) return { p, s: s + 1 }
    for (let q = p + 1; q < this.paras.length; q++) if (this.paras[q].sentences.length) return { p: q, s: 0 }
    return null
  }

  private before({ p, s }: PlayerPos): PlayerPos | null {
    if (s > 0) return { p, s: s - 1 }
    for (let q = p - 1; q >= 0; q--) if (this.paras[q].sentences.length) return { p: q, s: this.paras[q].sentences.length - 1 }
    return null
  }

  /** What to read for a sentence: the sentence itself, or the Japanese translation for Chinese books. */
  private textAt(pos: PlayerPos, tok?: number): Promise<string> {
    const sentence = this.paras[pos.p]?.sentences[pos.s] ?? ''
    return japaneseTextFor(this.lang, sentence, () => tok != null && tok !== this.token)
  }

  private prefetch(pos: PlayerPos) {
    if (getSettings().ttsEngine !== 'ai') return
    let cur: PlayerPos | null = pos
    const upcoming: PlayerPos[] = []
    for (let i = 0; i < 3 && cur; i++) {
      cur = this.after(cur)
      if (cur) upcoming.push(cur)
    }
    // Sequential so we never hammer the API with many parallel requests.
    ;(async () => {
      for (const p of upcoming) {
        try {
          const t = await this.textAt(p)
          if (hasSpeakable(t)) await getAiClip(t)
        } catch {
          return
        }
      }
    })()
  }

  private async playClip(blob: Blob, rate: number, tok: number) {
    const a = this.el()
    const url = URL.createObjectURL(blob)
    try {
      a.src = url
      a.playbackRate = rate
      a.preservesPitch = true
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          a.onended = a.onpause = a.onerror = null
          resolve()
        }
        a.onended = done
        a.onpause = () => {
          if (tok !== this.token) done()
        }
        a.onerror = () => {
          a.onended = a.onpause = a.onerror = null
          reject(new Error('音频播放失败'))
        }
        a.play().catch((e) => {
          a.onended = a.onpause = a.onerror = null
          if (tok !== this.token) resolve()
          else reject(new Error(e?.name === 'NotAllowedError' ? '浏览器阻止了自动播放，请再点一次播放' : '音频播放失败'))
        })
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  private async loop(tok: number) {
    while (tok === this.token && this.state.playing && this.state.pos) {
      const pos = this.state.pos
      const { ttsEngine, ttsRate } = getSettings()
      try {
        this.set({ loading: true })
        const text = await this.textAt(pos, tok)
        if (tok !== this.token) return
        if (hasSpeakable(text)) {
          if (ttsEngine === 'ai') {
            this.prefetch(pos)
            const blob = await getAiClip(text)
            if (tok !== this.token) return
            this.set({ loading: false })
            await this.playClip(blob, ttsRate, tok)
          } else {
            this.set({ loading: false })
            await speakSystem(text, ttsRate, () => tok !== this.token)
          }
        }
      } catch (e) {
        if (tok === this.token) this.set({ playing: false, loading: false, error: (e as Error).message })
        return
      }
      if (tok !== this.token) return
      const n = this.after(pos)
      if (!n) {
        this.set({ playing: false, loading: false })
        return
      }
      this.set({ pos: n })
    }
  }

  private setupMediaSession() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms) return
    try {
      ms.setActionHandler('play', () => this.play())
      ms.setActionHandler('pause', () => this.pause())
      ms.setActionHandler('nexttrack', () => this.next())
      ms.setActionHandler('previoustrack', () => this.prev())
    } catch {
      /* unsupported action */
    }
  }

  private updateMediaSession() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms || typeof MediaMetadata === 'undefined') return
    if (!this.state.active) return
    ms.playbackState = this.state.playing ? 'playing' : 'paused'
    const pos = this.state.pos
    const line = pos ? (this.paras[pos.p]?.sentences[pos.s] ?? '') : ''
    ms.metadata = new MediaMetadata({ title: line.slice(0, 40) || this.title, artist: this.title, album: '日语阅读' })
  }
}

export const player = new Player()

// ---------- single sentence ----------

export interface OnceState {
  /** Id of the sentence being read (caller-defined), or null. */
  key: string | null
  loading: boolean
  error: string
}

let once: OnceState = { key: null, loading: false, error: '' }
const onceListeners = new Set<() => void>()
let onceToken = 0
let onceAudio: HTMLAudioElement | null = null

function setOnce(patch: Partial<OnceState>) {
  once = { ...once, ...patch }
  onceListeners.forEach((l) => l())
}

export function useOnce() {
  return useSyncExternalStore(
    (l) => {
      onceListeners.add(l)
      return () => onceListeners.delete(l)
    },
    () => once,
  )
}

export function stopOnce() {
  onceToken++
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  onceAudio?.pause()
  if (once.key || once.loading) setOnce({ key: null, loading: false })
}

/** Reads one sentence aloud at the given rate (pauses continuous listening). Call from a tap. */
export async function speakOnce(lang: Lang, sentence: string, key: string, rate: number) {
  if (player.state.playing) player.pause()
  stopOnce()
  const tok = ++onceToken
  const engine = getSettings().ttsEngine
  if (engine === 'ai') {
    // Unlock the element inside the tap so it may play after the network wait (iOS).
    onceAudio ??= new Audio()
    onceAudio.src = SILENT_WAV
    onceAudio.play().catch(() => {})
  }
  setOnce({ key, loading: true, error: '' })
  const cancelled = () => tok !== onceToken
  try {
    const text = await japaneseTextFor(lang, sentence, cancelled)
    if (cancelled() || !hasSpeakable(text)) return
    if (engine === 'ai') {
      const blob = await getAiClip(text)
      if (cancelled()) return
      setOnce({ loading: false })
      const a = onceAudio!
      const url = URL.createObjectURL(blob)
      try {
        a.src = url
        a.playbackRate = rate
        a.preservesPitch = true
        await new Promise<void>((resolve, reject) => {
          a.onended = () => resolve()
          a.onpause = () => resolve()
          a.onerror = () => reject(new Error('音频播放失败'))
          a.play().catch((e) => (cancelled() ? resolve() : reject(e)))
        })
      } finally {
        a.onended = a.onpause = a.onerror = null
        URL.revokeObjectURL(url)
      }
    } else {
      setOnce({ loading: false })
      await speakSystem(text, rate, cancelled)
    }
  } catch (e) {
    if (!cancelled()) setOnce({ error: (e as Error).message })
  } finally {
    if (!cancelled()) setOnce({ key: null, loading: false })
  }
}

export function usePlayer() {
  return useSyncExternalStore(player.subscribe, () => player.state)
}

/** Plays one sample sentence with the current settings (for the settings page). */
export async function previewVoice(text: string) {
  const s = getSettings()
  if (s.ttsEngine === 'ai') {
    const blob = await getAiClip(text)
    const a = new Audio(URL.createObjectURL(blob))
    a.playbackRate = s.ttsRate
    await a.play()
  } else {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    await speakSystem(text, s.ttsRate, () => false)
  }
}
