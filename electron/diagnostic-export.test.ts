import { describe, expect, it, vi } from 'vitest'
import { DiagnosticExporter } from './diagnostic-export'

describe('diagnostic export transaction', () => {
  it.each([{ canceled: true, filePath: 'must-not-write' }, { canceled: false }])('does not write without a confirmed destination', async destination => {
    const write = vi.fn()
    expect(await new DiagnosticExporter().save({ sample: 1 }, async () => destination, write)).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('freezes the report before the dialog and ignores concurrent export requests', async () => {
    const exporter = new DiagnosticExporter()
    const report = { position: 1000 }
    let select!: (destination: { canceled: boolean; filePath: string }) => void
    const write = vi.fn(async () => {})
    const pending = exporter.save(report, () => new Promise(resolve => { select = resolve }), write)
    report.position = 5000
    const secondDialog = vi.fn()
    expect(await exporter.save(report, secondDialog, write)).toBe(false)
    expect(secondDialog).not.toHaveBeenCalled()
    select({ canceled: false, filePath: 'chosen.json' })
    expect(await pending).toBe(true)
    expect(write).toHaveBeenCalledWith('chosen.json', JSON.stringify({ position: 1000 }, null, 2))
  })

  it('reports write failure and permits a subsequent retry', async () => {
    const exporter = new DiagnosticExporter()
    const choose = async () => ({ canceled: false, filePath: 'chosen.json' })
    await expect(exporter.save({}, choose, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(await exporter.save({}, choose, async () => {})).toBe(true)
  })
})
