/**
 * The constant amount by which a secondary track (a translation, romaji) runs
 * late (positive) or early (negative) against the rows it belongs to, when it
 * clearly does: the shift that puts most of its stamps on a row start. 0 when
 * the stamps already sit on the rows, or no single shift stands out.
 *
 * Row by row the question cannot be answered where rows are short: a stamp
 * 900 ms before one row is also 700 ms after the row before it. Looking a
 * fixed 1.2 s ahead put every late stamp one row late in a fast passage;
 * taking the nearer row start put every early one a row early. A whole track
 * that is off (the original nudged in the editor, an imported translation, a
 * provider translation that leads its lines) is off by the same amount on
 * every row, and the rows of a song are not evenly spaced, so the amount shows.
 */
export function secondaryTrackShift(baseStarts: readonly number[], secondaryStarts: readonly number[], limitMs = 1200): number {
  // A dozen rows at least: on a handful of loosely stamped rows in a fast
  // passage some shift always "fits" better than none, and applying it moved
  // every row of a correct short track.
  if (baseStarts.length < 12 || secondaryStarts.length < 12) return 0
  const bucketMs = 40
  const nearMs = 200
  const counts = new Map<number, number[]>()
  let low = 0
  let near = 0
  for (const start of secondaryStarts) {
    while (low < baseStarts.length && baseStarts[low] < start - limitMs) low += 1
    let isNear = false
    for (let index = low; index < baseStarts.length && baseStarts[index] <= start + limitMs; index += 1) {
      const difference = start - baseStarts[index]
      if (Math.abs(difference) <= nearMs) isNear = true
      const bucket = Math.round(difference / bucketMs)
      const list = counts.get(bucket)
      if (list) list.push(difference)
      else counts.set(bucket, [difference])
    }
    if (isNear) near += 1
  }
  // A shift may straddle two buckets: count each bucket with its neighbour.
  const support = (bucket: number) => (counts.get(bucket)?.length ?? 0) + Math.max(counts.get(bucket - 1)?.length ?? 0, counts.get(bucket + 1)?.length ?? 0)
  // Rows within 200 ms of a row start are in place already (loose stamping, not a shift).
  const inPlace = Math.max(support(0), near)
  let best = 0
  let bestSupport = support(0)
  for (const bucket of counts.keys()) {
    const value = support(bucket)
    if (value > bestSupport || (value === bestSupport && Math.abs(bucket) < Math.abs(best))) { best = bucket; bestSupport = value }
  }
  // Most of the track has to move together, and clearly more of it than already sits on its rows.
  if (Math.abs(best) * bucketMs <= nearMs || bestSupport < secondaryStarts.length * .6 || bestSupport < inPlace * 2) return 0
  const differences = [...(counts.get(best) ?? []), ...(counts.get(best - 1) ?? []), ...(counts.get(best + 1) ?? [])]
    .filter(difference => Math.abs(difference - best * bucketMs) <= bucketMs).sort((left, right) => left - right)
  return differences.length ? differences[Math.floor(differences.length / 2)] : 0
}
