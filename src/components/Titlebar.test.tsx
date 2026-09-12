import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { version } from '../../package.json'
import { Titlebar } from './Titlebar'

describe('release identity', () => {
  it('renders the package version instead of a manually maintained label', () => {
    expect(renderToStaticMarkup(<Titlebar />)).toContain(`<span class="version">${version}</span>`)
  })
})
