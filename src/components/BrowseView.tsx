import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Check, Copy, RefreshCw, Search, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useBrowseStore } from '../store/useBrowseStore'
import { LyricsStage } from './LyricsStage'
import { coverTile, librarySourceTag, matchesLibraryQuery } from './LibraryView'
import { documentPlainText, hasReadableLyrics, hitDuration, type SongHit } from '../lib/song-reader'
import { hasKana, scriptPresentation } from '../lib/script'
import { LYRICS_SOURCES, lyricsSourceIdOf } from '../lib/lyrics-source'
import { localizeLabel, sourceLabel } from '../lib/source-label'
import { t, tk } from '../lib/i18n'
import { useKanaRow } from '../hooks/useKanaRow'

const CATALOGUE_LABEL: Record<string, string> = { lrclib: 'LRCLIB', netease: tk('网易云音乐') }
/** Songs of the library offered before and while typing. */
const SAVED_SHOWN = 8

function Tile({ name, cover }: { name: string | undefined; cover?: string }) {
  const tile = coverTile(name)
  return <div className="library-cover" style={cover ? undefined : { '--tile-hue': tile.hue } as React.CSSProperties}>
    {cover ? <img src={cover} /> : <span className="cover-initial">{tile.initial}</span>}
  </div>
}

/** A row that opens a song: a library entry or a search hit. */
function SongRow({ name, artist, album, cover, tags, onOpen }: { name: string; artist: string; album: string; cover?: string; tags: string[]; onOpen(): void }) {
  const context = [name, artist, album].find(hasKana) ?? ''
  return <article className="browse-row" role="button" tabIndex={0} title={t('查看歌词')} onClick={onOpen}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }}>
    <Tile name={name} cover={cover} />
    <div className="library-copy">
      <strong {...scriptPresentation(name, context)}>{name}</strong>
      <span><span {...scriptPresentation(artist, context)}>{artist || t('未知艺人')}</span>{album && album.trim().toLowerCase() !== name.trim().toLowerCase() ? ` · ${album}` : ''}</span>
      {tags.length > 0 && <div>{tags.map(tag => <i key={tag} className="source-tag">{tag}</i>)}</div>}
    </div>
  </article>
}

function Reader() {
  const reading = useBrowseStore(state => state.reading)!
  const close = useBrowseStore(state => state.close)
  const openHit = useBrowseStore(state => state.openHit)
  const settings = useAppStore(state => state.settings)
  // A library song is read live: a re-match or an edit while it is open shows at once.
  const savedId = reading.origin === 'library' ? reading.document?.trackId : undefined
  const saved = useAppStore(state => savedId ? state.library[savedId] : undefined)
  const document = saved ?? reading.document
  const shownDocument = useKanaRow(document ?? null, settings.enabledLanguages)
  const track = document?.track
  const name = track?.name ?? reading.hit?.name ?? ''
  const artist = track?.artist ?? reading.hit?.artist ?? ''
  const album = track?.album ?? reading.hit?.album ?? ''
  const length = hitDuration(track?.durationMs ?? reading.hit?.durationMs ?? 0)
  const original = document?.tracks.find(item => item.kind === 'original') ?? document?.tracks[0]
  const context = [name, artist, album].find(hasKana) ?? ''
  const shownSource = original?.source ?? document?.untimedOriginal?.source
  const source = shownSource ? localizeLabel(LYRICS_SOURCES.find(item => item.id === lyricsSourceIdOf(shownSource))?.label) || sourceLabel(shownSource) : ''
  const text = useMemo(() => documentPlainText(document ?? null), [document])
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('')
  const copiedTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])
  useEffect(() => setCopied(''), [reading.key])
  const copy = async () => {
    let done = true
    try {
      // Main-process clipboard first (works without window focus); it answers false when it could not write.
      const written = window.syllable.app?.copyText ? await window.syllable.app.copyText(text) : false
      if (!written) await navigator.clipboard.writeText(text)
    } catch { done = false }
    setCopied(done ? 'done' : 'failed')
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(''), 1800)
  }
  // Esc goes back to the results, after anything opened on top (find bar, row menu) has closed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (window.document.querySelector('.editor-backdrop, .lyrics-find, .lyric-menu, .source-popover')) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return <>
    <div className="now-header browse-reader-header">
      <div className="now-track-heading">
        <button className="browse-back" title={t('返回（Esc）')} aria-label={t('返回')} onClick={close}><ArrowLeft size={18} /></button>
        <div className="header-cover">{track?.coverUrl ? <img src={track.coverUrl} /> : <span className="cover-initial" style={{ '--tile-hue': coverTile(name).hue } as React.CSSProperties}>{coverTile(name).initial}</span>}</div>
        <div>
          <span className="eyebrow"><Search size={12} /><span>{reading.origin === 'library' ? t('资料库里的歌词') : t('查歌词')}</span></span>
          <h1 {...scriptPresentation(name, context, original?.language)}>{name || t('未知歌曲')}</h1>
          <p><span {...scriptPresentation(artist, context, original?.language)}>{artist || t('未知艺人')}</span>{album && album.trim().toLowerCase() !== name.trim().toLowerCase() && <><i /><span>{album}</span></>}{length && <><i /><span>{length}</span></>}</p>
        </div>
      </div>
      <div className="source-badges">
        {source && reading.status === 'ready' && <span title={t('这份歌词的来源')}>{source}</span>}
        {text && reading.status === 'ready' && <button className="header-edit" onClick={() => void copy()}>{copied === 'done' ? <Check size={13} /> : <Copy size={13} />}{copied === 'done' ? t('已复制') : copied === 'failed' ? t('复制失败') : t('复制歌词')}</button>}
      </div>
    </div>
    <div className={`lyric-card ${settings.mainAlignment === 'center' ? 'lyrics-centered' : ''}`}>
      {reading.status === 'loading' ? <div className="empty-lyrics"><span className="spinner" /><p>{t('正在查找歌词…')}</p></div>
        : reading.status === 'missing' ? <div className="empty-lyrics"><AlertCircle size={24} /><h3>{t('没有找到这首歌的歌词')}</h3><p>{t('几个歌词源都没有收录。可以返回换一个版本，或者换个写法再搜。')}</p><div className="empty-actions"><button className="quiet" onClick={close}><ArrowLeft size={14} />{t('返回结果')}</button></div></div>
        : reading.status === 'failed' ? <div className="empty-lyrics"><AlertCircle size={24} /><h3>{t('歌词源暂时没有响应')}</h3><p>{t('网络或歌词源出了点问题。')}</p><div className="empty-actions">{reading.hit && <button onClick={() => void openHit(reading.hit!, true)}><RefreshCw size={14} />{t('重试')}</button>}<button className="quiet" onClick={close}><ArrowLeft size={14} />{t('返回结果')}</button></div></div>
        : <LyricsStage key={reading.key} reading document={shownDocument} positionMs={-1} enabled={settings.enabledLanguages} romanization={settings.romanization} />}
    </div>
  </>
}

export function BrowseView() {
  const { query, searchedQuery, hits, failed, searching, searchError, reading, setQuery, search, openHit, openSaved } = useBrowseStore()
  const library = useAppStore(state => state.library)
  const saved = useMemo(() => Object.values(library).filter(hasReadableLyrics).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [library])
  const typed = query.trim()
  const matchingSaved = useMemo(() => saved.filter(document => matchesLibraryQuery(document, typed)), [saved, typed])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!reading) input.current?.focus() }, [reading])
  if (reading) return <Reader />

  const hitTags = (hit: SongHit) => [hitDuration(hit.durationMs), ...hit.sources.map(source => t(CATALOGUE_LABEL[source] ?? source)), ...(hit.instrumental ? [t('纯音乐')] : [])].filter(Boolean)
  const failedNames = failed.map(source => t(CATALOGUE_LABEL[source] ?? source)).join(t('、'))
  const searchedThis = searchedQuery !== '' && searchedQuery === typed
  return <div className="content-page browse-page">
    <div className="content-page-header"><span>LYRIC SEARCH</span><h1>{t('查歌词')}</h1><p>{t('不用播放也能看歌词：输入歌名或艺人搜索，或者直接打开资料库里的歌。')}</p></div>
    <form className="library-toolbar browse-toolbar" role="search" onSubmit={event => { event.preventDefault(); void search() }}>
      <label className="library-search"><Search size={14} />
        <input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('歌名、艺人，例如：夜に駆ける YOASOBI')} aria-label={t('搜索歌曲')} spellCheck={false} />
        {query && <button type="button" title={t('清除')} aria-label={t('清除')} onClick={() => { setQuery(''); input.current?.focus() }}><X size={14} /></button>}
      </label>
      <button type="submit" className="browse-submit" disabled={!typed || searching}>{searching ? t('搜索中…') : t('搜索')}</button>
    </form>

    {matchingSaved.length > 0 && <section className="browse-section">
      <h2>{typed ? t('资料库里的歌') : t('最近的歌')}<span>{typed && matchingSaved.length > SAVED_SHOWN ? t('前 {shown} 首，共 {total} 首', { shown: SAVED_SHOWN, total: matchingSaved.length }) : ''}</span></h2>
      <div className="library-grid">{matchingSaved.slice(0, SAVED_SHOWN).map(document => <SongRow key={document.trackId}
        name={document.track?.name ?? document.trackId} artist={document.track?.artist ?? ''} album={document.track?.album ?? ''} cover={document.track?.coverUrl || undefined}
        tags={[t('资料库'), librarySourceTag(document)].filter(Boolean)} onOpen={() => openSaved(document)} />)}</div>
    </section>}

    {searching && <div className="browse-status"><span className="spinner" /><p>{t('正在搜索「{query}」…', { query: typed })}</p></div>}
    {!searching && searchError && <div className="browse-status" role="alert"><AlertCircle size={22} /><p>{searchError}</p><button onClick={() => void search()}><RefreshCw size={14} />{t('重试')}</button></div>}
    {!searching && !searchError && searchedThis && (hits.length > 0 ? <section className="browse-section">
      <h2>{t('搜索结果')}<span>{t('{count} 首', { count: hits.length })}{failed.length > 0 ? ' · ' + t('{sources}暂时没有响应', { sources: failedNames }) : ''}</span></h2>
      <div className="library-grid">{hits.map(hit => <SongRow key={hit.key} name={hit.name} artist={hit.artist} album={hit.album} tags={hitTags(hit)} onOpen={() => void openHit(hit)} />)}</div>
    </section> : failed.length > 0
      // One catalogue said nothing matches, the other did not answer: that is not "not found".
      ? <div className="browse-status" role="alert"><AlertCircle size={22} /><p>{t('{sources}暂时没有响应，另一个曲库里没有「{query}」。', { sources: failedNames, query: searchedQuery })}</p><button onClick={() => void search()}><RefreshCw size={14} />{t('重试')}</button></div>
      : <div className="browse-status"><Search size={24} /><p>{t('没有找到「{query}」。试试只写歌名，或者加上艺人。', { query: searchedQuery })}</p></div>)}
    {!searching && !searchError && !searchedThis && typed !== '' && <p className="browse-hint">{t('按 Enter 在线搜索「{query}」', { query: typed })}</p>}
  </div>
}
