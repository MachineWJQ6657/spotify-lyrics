// Read-only package identity check. Does not launch the app or touch user data.
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const asar = require('@electron/asar')

const directory = path.resolve(process.argv[2] || 'release/win-unpacked')
const archive = path.join(directory, 'resources', 'app.asar')
const expectedVersion = require('../package.json').version
const entries = asar.listPackage(archive)
const read = entry => asar.extractFile(archive, entry.replace(/^[\\/]/, '')).toString()
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'))
const mainEntry = entries.find(entry => entry.replace(/\\/g, '/') === '/out/main/main.js')
if (!mainEntry) throw new Error('Packaged main entry is missing')
const main = read(mainEntry)
const renderer = entries.filter(entry => /[\\/]renderer[\\/].*\.js$/.test(entry)).map(read).join('\n')
const checks = {
  executable: fs.existsSync(path.join(directory, 'Syllable.exe')),
  version: packaged.version === expectedVersion,
  main: packaged.main === './out/main/main.js',
  durationDiagnostic: main.includes('durationRatio='),
  pointerCaptureCleanup: renderer.includes('onLostPointerCapture'),
  timelineLabel: renderer.includes('SPOTIFY TIMELINE'),
  noUnsupportedAccuracyClaim: !renderer.includes('FRAME-ACCURATE CLOCK'),
  translationOwnership: main.includes('translationCounts.get(ownerIndex) === 1') && main.includes('anchor.targetIndices'),
  providerRevision33: renderer.includes('LYRICS_PROVIDER_REVISION = 33'),
}
console.log(JSON.stringify({ directory, expectedVersion, packagedVersion: packaged.version, checks,
  archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }, null, 2))
if (Object.values(checks).some(value => !value)) process.exitCode = 1
