# Data

## ja-en-lexicon.json

Japanese words with the stems of the English words a dictionary glosses them
with. The app uses it to line a pasted English translation up with Japanese
lyrics (`src/lib/pasted-translation.ts`, `src/lib/ja-en-lexicon.ts`).

- **Source**: [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project),
  the Japanese-Multilingual Dictionary of the Electronic Dictionary Research and
  Development Group (EDRDG), taken as JSON from
  [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)
  (`jmdict-eng-common`, the entries marked as common).
- **Licence**: JMdict is licensed under
  [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  `ja-en-lexicon.json` is derived from it and is under the same licence. This
  applies to that file only, not to the rest of the repository.
- **How it is built**: `node scripts/build-lexicon.mjs <jmdict-eng-common-*.json>`.
  For each entry that is a noun, verb, adjective or adverb, up to six stems from
  the glosses of its first three senses are kept, under each written form and,
  for inflected words, under the part that stays when they inflect.
  The `source` field of the file names the dictionary date it was built from.

## demo.ts

The demo song shown before any playback is detected.
