// Local publication guard: inspect both the index and the history being sent.
// .gitignore cannot exclude a force-added artifact, and a clean current tree
// cannot undo an earlier binary commit that is still part of the pending push.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function publicationArtifacts(files) {
  return files.filter(file => {
    // Git emits slash-separated names even on Windows. Treat backslashes and
    // trailing spaces conservatively too, so unusual names cannot bypass the
    // guard before being checked out on a Windows filesystem.
    const name = file.replace(/\\/g, '/').replace(/[ .]+$/, '')
    return /(?:^|\/)(?:release|out|dist|node_modules|\.tools|\.qa[^/]*|qa-[^/]*|checkpoints|user-test-[^/]*)\//i.test(name)
      || /\.(?:exe|msi|msix|appx|zip|7z|asar|blockmap|nupkg|dmp|pem|key|pfx|onnx|gguf|ggml|safetensors|pt|pth|ckpt|tflite|bin|wav|mp3|flac|m4a|pcm)$/i.test(name)
      || /(?:^|\/)qa-.*\.(?:png|log)$/is.test(name)
      || /(?:^|\/)\.env(?:\..+)?$/i.test(name) && !/(?:^|\/)\.env\.example$/i.test(name)
  })
}

function parsePushUpdates(input) {
  if (Buffer.byteLength(input, 'utf8') > 1_048_576) throw Error('Push update list exceeds the safety limit')
  const lines = input.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length > 1024) throw Error('Too many push updates for one guarded operation')
  return lines.map((line, index) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4) throw Error(`Invalid pre-push record at line ${index + 1}`)
    const [localRef, localSha, remoteRef, remoteSha] = fields
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(localSha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(remoteSha)
      || localSha.length !== remoteSha.length) throw Error(`Invalid pre-push object ID at line ${index + 1}`)
    // Never interpolate reference names or remote URLs into a shell command.
    // Only validated object IDs and fixed arguments reach git below.
    return { localRef, localSha, remoteRef, remoteSha }
  })
}

function pushRevisionArgs(update) {
  if (/^0+$/.test(update.localSha)) return [] // Ref deletion sends no objects.
  return /^0+$/.test(update.remoteSha)
    ? [update.localSha, '--not', '--remotes']
    : [`${update.remoteSha}..${update.localSha}`]
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })
}

function inspectPublication(root, updates = []) {
  const indexed = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const outgoing = new Set()
  const newObjects = new Set()
  for (const update of updates) {
    const revisions = pushRevisionArgs(update)
    if (!revisions.length) continue
    // Branches and annotated/lightweight version tags must resolve to a
    // commit. A tag pointing directly at an arbitrary blob/tree has no path
    // history to classify; refusing it is safer than calling it clean.
    git(root, ['rev-parse', '--verify', `${update.localSha}^{commit}`])
    // Count the actual new objects, without ambiguous quoted path names.
    // A bad/missing remote object or unsupported ref fails closed, not clean.
    const objects = git(root, ['rev-list', '--objects', '--no-object-names', ...revisions]).split('\n').filter(Boolean)
    for (const object of objects) newObjects.add(object)
    // rev-list --objects gives a blob only one canonical pathname. Inspect
    // every added/modified tree path in outgoing commits as well: a previously
    // known source blob can otherwise be copied to setup.exe undetected.
    // --root includes a new repository's first commit, -m covers merge-only
    // additions, and -z preserves whitespace/newlines rather than guessing
    // where a filename ends. Added-then-deleted artifacts remain observable;
    // deletion-only cleanup of a previously remote artifact stays possible.
    const names = git(root, ['log', '--format=', '--name-only', '-z', '--root', '-m', '--no-renames', '--diff-filter=AMT', ...revisions])
    for (const file of names.split('\0').filter(Boolean)) outgoing.add(file)
  }
  const indexedArtifacts = publicationArtifacts(indexed)
  const outgoingArtifacts = publicationArtifacts([...outgoing])
  return { passed: indexedArtifacts.length === 0 && outgoingArtifacts.length === 0,
    indexedFiles: indexed.length, outgoingFiles: outgoing.size, newObjects: newObjects.size,
    indexedArtifacts, outgoingArtifacts }
}

module.exports = { publicationArtifacts, parsePushUpdates, pushRevisionArgs, inspectPublication }
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..')
    const updates = process.argv.includes('--pre-push') ? parsePushUpdates(fs.readFileSync(0, 'utf8')) : []
    const result = inspectPublication(root, updates)
    if (!result.passed) {
      if (result.indexedArtifacts.length) console.error('Refusing publication: generated/private artifacts are tracked in the Git index:\n' + result.indexedArtifacts.join('\n'))
      if (result.outgoingArtifacts.length) console.error('Refusing publication: generated/private artifacts remain in the outgoing commit history:\n' + result.outgoingArtifacts.join('\n'))
      console.error('Removing a file from the latest tree does not remove it from an earlier commit. Nothing was pushed by this guard.')
      process.exitCode = 1
    } else console.log(`Publication guard passed: ${result.indexedFiles} indexed files; ${result.outgoingFiles} outgoing paths / ${result.newObjects} new objects; no release/installers/test profiles/models/private artifacts.`)
  } catch (error) {
    console.error(`Publication guard could not verify the pending update; refusing push: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
