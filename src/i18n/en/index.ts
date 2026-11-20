import { SHELL } from './shell'
import { SETTINGS } from './settings'
import { INFO } from './info'
import { STAGE } from './stage'
import { STATUS } from './status'
import { MAIN } from './main'

/** Every English entry, keyed by the Chinese source text. One text has one translation wherever it appears. */
export const EN: Record<string, string> = { ...MAIN, ...STATUS, ...STAGE, ...INFO, ...SETTINGS, ...SHELL }
