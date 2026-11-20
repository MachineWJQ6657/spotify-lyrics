import { Minus, Square, X } from 'lucide-react'
import { t } from '../lib/i18n'

export function WindowControls() {
  return <div className="window-controls no-drag">
    <button aria-label={t('最小化')} onClick={() => void window.syllable.window.minimize()}><Minus size={14} /></button>
    <button aria-label={t('最大化')} onClick={() => void window.syllable.window.maximize()}><Square size={11} /></button>
    <button className="window-close" aria-label={t('关闭')} title={t('关闭窗口（桌面歌词继续运行，可从系统托盘打开或退出）')} onClick={() => void window.syllable.window.close()}><X size={14} /></button>
  </div>
}
