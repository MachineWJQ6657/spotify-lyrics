declare module 'kuroshiro' {
  export default class Kuroshiro {
    init(analyzer: unknown): Promise<void>
    convert(text: string, options: Record<string, string>): Promise<string>
  }
}
declare module 'kuroshiro-analyzer-kuromoji' {
  export default class KuromojiAnalyzer { constructor(options?: { dictPath?: string }) }
}
