import { useEffect, useRef, useState, type ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  book: <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5zM20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z" />,
  bookmark: <path d="M7 4h10v16l-5-3.5L7 20z" />,
  cards: <path d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zM9 9h6M9 13h4" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />,
  file: <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5" />,
  paste: <path d="M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 005 7v12.5A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V7a1.5 1.5 0 00-1.5-1.5H16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
}

export function Icon({ name, size = 22, filled = false }: { name: keyof typeof paths | string; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  )
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [render, setRender] = useState(open)
  useEffect(() => {
    if (open) setRender(true)
    else {
      const t = setTimeout(() => setRender(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])
  if (!render) return null
  return (
    <div className={`sheet-root ${open ? 'open' : ''}`}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog">
        <div className="sheet-handle" onClick={onClose} />
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export function PromptDialog({
  open,
  title,
  initial,
  confirmText = '确定',
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  initial: string
  confirmText?: string
  onConfirm: (v: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setValue(initial)
      setTimeout(() => ref.current?.focus(), 50)
    }
  }, [open, initial])
  if (!open) return null
  return (
    <div className="dialog-root">
      <div className="sheet-backdrop" onClick={onClose} />
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onConfirm(value.trim())
        }}
      >
        <h3>{title}</h3>
        <input ref={ref} className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn primary">
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  )
}

export function TopBar({ title, onBack, right, onTitleClick }: { title: ReactNode; onBack?: () => void; right?: ReactNode; onTitleClick?: () => void }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <Icon name="back" />
        </button>
      ) : (
        <span className="topbar-spacer" />
      )}
      <h1 className={`topbar-title ${onTitleClick ? 'clickable' : ''}`} onClick={onTitleClick}>
        {title}
      </h1>
      <div className="topbar-right">{right ?? <span className="topbar-spacer" />}</div>
    </header>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </span>
  )
}

export function JlptBadge({ jlpt }: { jlpt?: string }) {
  if (!jlpt) return null
  return <span className={`badge jlpt-${jlpt.toLowerCase()}`}>{jlpt}</span>
}
