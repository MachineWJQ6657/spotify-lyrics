import { memo } from 'react'
import { t } from '../lib/i18n'
import { Captions, CircleHelp, LayoutDashboard, Radio, Search, Settings2, Sparkles } from 'lucide-react'

export type AppView = 'now' | 'browse' | 'library' | 'sources' | 'settings' | 'help'

export const Sidebar = memo(function Sidebar({ active, onChange, news = false }: { active: AppView; onChange(view: AppView): void
  /** An update the user has not read about yet: marks the help page, where the list is. */
  news?: boolean }) {
  return <aside className="sidebar">
    <nav>
      <button onClick={() => onChange('now')} className={`nav-item ${active === 'now' ? 'active' : ''}`}><LayoutDashboard size={18} /><span>{t('正在播放')}</span></button>
      <button onClick={() => onChange('browse')} className={`nav-item ${active === 'browse' ? 'active' : ''}`}><Search size={18} /><span>{t('查歌词')}</span></button>
      <button onClick={() => onChange('library')} className={`nav-item ${active === 'library' ? 'active' : ''}`}><Captions size={18} /><span>{t('歌词资料库')}</span></button>
      <button onClick={() => onChange('sources')} className={`nav-item ${active === 'sources' ? 'active' : ''}`}><Radio size={18} /><span>{t('歌词源')}</span></button>
    </nav>
    <div className="sidebar-spacer" />
    <div className="tip-card">
      <Sparkles size={17} />
      <p>{t('可直接拖入带语言后缀的 LRC，例如')} <code>song.zh.lrc</code></p>
    </div>
    <nav>
      <button className={`nav-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}><Settings2 size={18} /><span>{t('偏好设置')}</span></button>
      <button className={`nav-item ${active === 'help' ? 'active' : ''}`} onClick={() => onChange('help')}><CircleHelp size={18} /><span>{t('帮助与诊断')}</span>{news && <i className="nav-news" title={t('有新的更新内容')} aria-label={t('有新的更新内容')} />}</button>
    </nav>
  </aside>
})
