import { expect, it } from 'vitest'
import { parseEditableTime } from './LyricsEditor'

it('reads typed line times and rejects partial input', () => {
  expect(parseEditableTime('1:23.45')).toBe(83_450)
  expect(parseEditableTime(' 0:07.5 ')).toBe(7500)
  expect(parseEditableTime('12:05')).toBe(725_000)
  for (const partial of ['1:', '1', ':5', '1:2.', '1:60', '', 'abc']) expect(parseEditableTime(partial)).toBeNull()
})
