import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const { publicationArtifacts, parsePushUpdates, pushRevisionArgs, inspectPublication } = createRequire(import.meta.url)('../scripts/verify-repo-clean.cjs')
const sha = (digit: string, length = 40) => digit.repeat(length)
const update = (localSha = sha('a'), remoteSha = sha('b')) => ({ localRef: 'refs/heads/main', localSha, remoteRef: 'refs/heads/main', remoteSha })

describe('publication guard', () => {
  it('allows source, original icon assets, fixtures and the env template', () => {
    expect(publicationArtifacts(['src/App.tsx', 'build/icon.ico', 'docs/diagram.png', 'electron/fixture.json', '.env.example'])).toEqual([])
  })
  it.each([
    'release/current/Syllable.exe', 'old/Syllable-0.4.44-Setup.exe', 'Syllable-0.4.44.zip',
    'out/main/main.js', 'dist/renderer.js', '.qa-user-data-0445/Local Storage/leveldb/001.log',
    '.tools/audio-sync/model.bin', 'checkpoints/old.json', 'qa-old/test.json', 'qa-0445.png',
    'qa-0445.log', '.env', '.env.local', 'private.pfx', 'node_modules/electron/path.txt',
    'nested/release/package.json', 'nested/.qa-private/progress.json', 'weights/model.onnx',
    'model.gguf', 'weights.bin', 'recording.wav', 'portable.EXE ', 'nested\\.qa-profile\\settings.json',
    'qa-odd\nname.log', 'private/.ENV.local'
  ])('rejects tracked or force-added artifact %s', file => {
    expect(publicationArtifacts([file])).toEqual([file])
  })
  it('parses CRLF Git pre-push stdin without using ref names as arguments', () => {
    const parsed = parsePushUpdates(`refs/heads/main ${sha('a')} refs/heads/main ${sha('b')}\r\nrefs/tags/v1 ${sha('c')} refs/tags/v1 ${sha('0')}\r\n`)
    expect(parsed).toHaveLength(2)
    expect(pushRevisionArgs(parsed[0])).toEqual([`${sha('b')}..${sha('a')}`])
    expect(pushRevisionArgs(parsed[1])).toEqual([sha('c'), '--not', '--remotes'])
  })
  it('skips ref deletion and accepts SHA256 repository object IDs', () => {
    expect(pushRevisionArgs(parsePushUpdates(`(delete) ${sha('0')} refs/heads/old ${sha('a')}`)[0])).toEqual([])
    expect(parsePushUpdates(`refs/heads/main ${sha('a', 64)} refs/heads/main ${sha('b', 64)}`)).toHaveLength(1)
  })
  it.each([
    'refs/heads/main not-a-sha refs/heads/main not-a-sha',
    `refs/heads/main ${sha('a')} refs/heads/main`,
    `refs/heads/main ${sha('a')} refs/heads/main ${sha('b', 64)}`,
    `refs/heads/main --all refs/heads/main ${sha('b')}`,
    `refs/heads/main ${sha('a')} refs/heads/main ${sha('b')} extra`
  ])('fails closed for malformed pre-push record %s', input => {
    expect(() => parsePushUpdates(input)).toThrow()
  })
  it('does not invent updates when no refs are being sent', () => {
    expect(parsePushUpdates('\r\n')).toEqual([])
  })

  it('rejects binary history even after deletion leaves the current index clean', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'syllable-publication-guard-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    const commit = (message: string) => { git('add', '-A'); git('-c', 'user.name=Guard Fixture', '-c', 'user.email=guard-fixture@example.invalid', 'commit', '--quiet', '-m', message); return git('rev-parse', 'HEAD') }
    try {
      git('init', '--quiet')
      writeFileSync(path.join(root, 'source.txt'), 'fixture')
      const base = commit('source only')
      git('update-ref', 'refs/remotes/origin/main', base)
      // Use identical contents to an existing source blob. rev-list object
      // deduplication alone cannot reliably classify the second pathname.
      writeFileSync(path.join(root, 'old-client.exe'), 'fixture')
      const binaryCommit = commit('accidental old client')
      rmSync(path.join(root, 'old-client.exe'))
      const cleanTip = commit('remove old client from tip')
      const inspected = inspectPublication(root, [update(cleanTip, base)])
      expect(inspected.indexedArtifacts).toEqual([])
      expect(inspected.outgoingArtifacts).toContain('old-client.exe')
      expect(inspected.passed).toBe(false)
      // New branch creation excludes existing remotes but still sees both
      // unpushed commits, rather than trusting the now-clean current index.
      expect(inspectPublication(root, [update(cleanTip, sha('0'))]).outgoingArtifacts).toContain('old-client.exe')
      expect(inspectPublication(root, [update(base, base)]).passed).toBe(true)
      expect(inspectPublication(root, [update(sha('0'), binaryCommit)]).outgoingArtifacts).toEqual([])
      // Removing an artifact that the remote already contains must remain
      // possible; a deletion does not newly upload its old file contents.
      expect(inspectPublication(root, [update(cleanTip, binaryCommit)]).passed).toBe(true)
      // A direct blob/tree ref has no safe pathname/history to classify.
      const blob = git('rev-parse', 'HEAD:source.txt')
      expect(() => inspectPublication(root, [update(blob, sha('0'))])).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
