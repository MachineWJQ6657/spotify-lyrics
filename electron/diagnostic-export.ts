/** Only a user-selected destination may receive the frozen report. */
export class DiagnosticExporter {
  private busy = false

  async save(report: unknown, choose: () => Promise<{ canceled: boolean; filePath?: string }>, write: (path: string, content: string) => Promise<void>) {
    if (this.busy) return false
    this.busy = true
    try {
      // Snapshot before showing the dialog: playback may change while it is open.
      const content = JSON.stringify(report, null, 2)
      if (content == null) throw new Error('同步诊断内容无效')
      const destination = await choose()
      if (destination.canceled || !destination.filePath) return false
      await write(destination.filePath, content)
      return true
    } finally { this.busy = false }
  }
}
