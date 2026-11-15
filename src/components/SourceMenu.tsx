import { memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Search } from 'lucide-react'
import type { LyricsDocument, LyricsSourceId } from '../types'
import { sourceOptions } from '../lib/lyrics-source'

interface Props {
  document: LyricsDocument | null
  /** Text of the badge: the source on screen, or the lookup state. */
  label: string
  disabled?: boolean
  onSelect(source: LyricsSourceId | null): void
  onSearch(): void
}

/** The header's source badge, opening a menu to pick which provider supplies the timed lyrics. */
export const SourceMenu = memo(function SourceMenu({ document, label, disabled = false, onSelect, onSearch }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape, true) }
  }, [open])
  // A new song closes the menu: its rows describe the previous one.
  useEffect(() => setOpen(false), [document?.trackId])
  const options = sourceOptions(document)
  const automatic = !document?.sourcePreference
  const choose = (source: LyricsSourceId | null) => { setOpen(false); onSelect(source) }
  return <div className="source-menu" ref={root}>
    <button type="button" className="source-badge" disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      title="切换歌词来源" onClick={() => setOpen(value => !value)}>
      <Cloud size={13} /><em>{label}</em><ChevronDown size={12} />
    </button>
    {open && <div className="source-popover" role="menu" aria-label="歌词来源">
      <div className="source-popover-title">歌词来源</div>
      <button type="button" role="menuitemradio" aria-checked={automatic} className={automatic ? 'chosen' : ''} onClick={() => choose(null)}>
        <span><strong>自动选择</strong><small>比较各来源后选最合适的</small></span>{automatic && <Check size={14} />}
      </button>
      {options.map(option => <button type="button" role="menuitemradio" aria-checked={option.chosen} key={option.id}
        className={option.chosen ? 'chosen' : ''} disabled={!option.available} onClick={() => choose(option.id)}>
        <span><strong>{option.label}</strong><small>{!option.available ? '没有这首歌的同步歌词' : option.lines != null ? `${option.lines} 行${option.inUse ? ' · 正在使用' : ''}${option.differs ? ' · 内容与自动选择的不同' : ''}` : option.inUse ? '正在使用' : '点击查询'}</small></span>
        {option.chosen && <Check size={14} />}
      </button>)}
      {document?.sourceUnavailable && <p className="source-popover-note">所选来源没有这首歌的同步歌词，当前显示的是自动选择的结果。</p>}
      {document?.sourcePreference && document.sourceChosenBy === 'listening' && <p className="source-popover-note listening">听音校准发现原来的来源各句偏差不一致，改用了这个来源。</p>}
      <button type="button" role="menuitem" className="source-popover-search" onClick={() => { setOpen(false); onSearch() }}><Search size={13} />手动搜索其他版本…</button>
    </div>}
  </div>
})
