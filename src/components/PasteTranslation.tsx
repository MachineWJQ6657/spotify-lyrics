import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardPaste, Search, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { lexicalReader, loadLexicon } from '../lib/ja-en-lexicon'
import { pastedTranslationTrack, type PastedTranslation } from '../lib/pasted-translation'
import { t } from '../lib/i18n'

/** Languages a translation can be pasted for, and what to search the web for. */
export const PASTE_LANGUAGES: Record<string, { name: string; query: string }> = {
  en: { name: 'English', query: 'English translation lyrics' },
  'zh-Hans': { name: '中文', query: '中文翻译 歌词' } // i18n-ignore: a language's own name, and a search query in that language
}

/** A web search for a translation of the song, in the listener's own browser. */
export function searchTranslation(language: string, track: { name: string; artist: string } | null | undefined) {
  const target = PASTE_LANGUAGES[language]
  if (!target || !track?.name) return
  window.open(`https://www.bing.com/search?q=${encodeURIComponent(`${track.name} ${track.artist} ${target.query}`)}`)
}

/**
 * Takes a translation copied from a web page and puts it on the current
 * song's lines (see lib/pasted-translation.ts for how the lines are matched).
 */
export function PasteTranslation({ language, onClose }: { language: string; onClose(): void }) {
  const lyrics = useAppStore(state => state.lyrics)
  const playing = useAppStore(state => state.playback?.track ?? null)
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [done, setDone] = useState<PastedTranslation | null>(null)
  const [message, setMessage] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const original = lyrics?.tracks.find(track => track.kind === 'original') ?? null
  const song = lyrics?.track ?? playing
  const target = PASTE_LANGUAGES[language]
  // The song the dialog was opened for: a translation never lands on the next one.
  const openedFor = useRef(lyrics?.trackId)
  const sameSong = lyrics?.trackId === openedFor.current

  useEffect(() => { field.current?.focus() }, [])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [onClose])

  const apply = async () => {
    if (!original || !sameSong || working) return
    setWorking(true); setMessage('')
    try {
      // Meaning can be checked for Japanese lyrics and an English translation: that is what the dictionary covers.
      const lexical = language === 'en' && original.language === 'ja' ? lexicalReader(await loadLexicon()) : undefined
      const result = pastedTranslationTrack(original, text, language, lexical)
      const state = useAppStore.getState()
      if (state.lyrics?.trackId !== openedFor.current) { setMessage(t('歌已经换了，翻译没有放上去')); return }
      if (!result) { setMessage(t('粘贴的内容太少，不像这首歌的翻译')); return }
      state.addLyricTrack(result.track)
      if (!state.settings.enabledLanguages.includes(language)) state.patchSettings({ enabledLanguages: [...state.settings.enabledLanguages, language] })
      setDone(result)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setWorking(false) }
  }

  if (!target) return null
  return createPortal(<div className="editor-backdrop no-drag" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="paste-dialog" role="dialog" aria-modal="true" aria-label={t('粘贴翻译')}>
      <div className="editor-header"><div><span>{target.name.toUpperCase()}</span><h2>{t('粘贴翻译')}</h2></div><button title={t('关闭')} aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></div>
      <p className="paste-song">{song ? `${song.name} · ${song.artist}` : t('没有正在播放的歌曲')}</p>
      {done ? <>
        <p className="paste-result">{done.placed === 'aligned'
          ? t('已放到歌词上：{lines} 行翻译对到了 {rows} 句歌词。分行和歌词不同的地方是按词义和长度对的，不对的行可以在「编辑」里改。', { lines: done.lines, rows: done.rows })
          : t('已放到歌词上：{lines} 行翻译，{rows} 句歌词。', { lines: done.lines, rows: done.rows })}</p>
        <div className="paste-actions"><span /><button className="wide-button" onClick={() => { setDone(null); setText('') }}>{t('重新粘贴')}</button><button className="wide-button primary" onClick={onClose}>{t('完成')}</button></div>
      </> : <>
        <textarea ref={field} value={text} spellCheck={false} placeholder={t('在浏览器里找到这首歌的翻译，复制后粘贴到这里。')} onChange={event => setText(event.target.value)} />
        <p className="paste-hint">{language === 'en' && original?.language === 'ja'
          ? t('只粘贴翻译本身。分行和歌词不一样也可以，会按词义自动对上；带时间的 LRC 也可以直接粘贴。')
          : t('只粘贴翻译本身，分行最好和歌词一致；带时间的 LRC 也可以直接粘贴。')}</p>
        {language === 'en' && original?.language === 'ja' && <p className="paste-credit">{t('按词义对行使用 JMdict 词典（EDRDG，CC BY-SA 4.0）。')}</p>}
        <div className="paste-actions">
          <button className="wide-button" disabled={!song} onClick={() => searchTranslation(language, song)}><Search size={15} />{t('上网查找')}</button>
          <span>{message}</span>
          <button className="wide-button primary" disabled={!original || !sameSong || working || text.trim().length < 10} onClick={() => { void apply() }}><ClipboardPaste size={15} />{t('放到歌词上')}</button>
        </div>
      </>}
    </div>
  </div>, document.body)
}
