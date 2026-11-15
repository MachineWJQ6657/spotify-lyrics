// node scripts/qa/provider-compare/show.mjs <compare.json> : the differences compare.mjs found, cut short
import fs from 'node:fs'
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const cut = diff => typeof diff === 'string' ? diff : `-${diff.onlyOld.length} +${diff.onlyNew.length} | old: ${diff.onlyOld.slice(0, 3).map(row => row.slice(0, 26)).join(' ¦ ')} | new: ${diff.onlyNew.slice(0, 3).map(row => row.slice(0, 26)).join(' ¦ ')}`
console.log('songs', report.length, 'same', report.filter(entry => entry.same).length, 'errors', report.filter(entry => entry.error).length)
for (const entry of report.filter(item => !item.same && !item.error)) {
  console.log(`## ${entry.name} — ${entry.artist} (${Math.round(entry.durationMs / 1000)} s)`)
  if (JSON.stringify(entry.old?.source) !== JSON.stringify(entry.new?.source) || entry.old?.transient !== entry.new?.transient || entry.old?.rows !== entry.new?.rows)
    console.log(`   old ${entry.old?.source} t=${entry.old?.transient} rows=${entry.old?.rows} | new ${entry.new?.source} t=${entry.new?.transient} rows=${entry.new?.rows}`)
  if (entry.lyricDiff && (entry.lyricDiff.onlyOld.length || entry.lyricDiff.onlyNew.length)) console.log('   original', cut(entry.lyricDiff))
  for (const [id, diff] of Object.entries(entry.extraDiff ?? {})) if (typeof diff === 'string' || diff.onlyOld.length || diff.onlyNew.length) console.log('  ', id, cut(diff))
  const oldIds = (entry.old?.extras ?? []).map(extra => extra.split(' ')[0]), newIds = (entry.new?.extras ?? []).map(extra => extra.split(' ')[0])
  if (oldIds.join() !== newIds.join()) console.log('   tracks old', oldIds.join(','), '| new', newIds.join(','))
}
