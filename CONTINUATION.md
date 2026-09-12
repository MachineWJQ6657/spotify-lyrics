# Syllable continuation checkpoint — 2026-09-12 / 0.4.21 candidate

## Latest source: 0.4.21 (candidate, not fully accepted)

- Post-package QA-only source improvement: overlay-controls and overlay-drag-open-guard now require explicit observations via createQaChecks; missing windows/steps, absent immediate button, wrong visible/minimized states fail exit1. Failed observations remain failed on later success. Three helper regressions pass; full197 offline pass,33 online skipped, build exit0.
- Current built source (node_modules/electron/dist/electron.exe out/main/main.js, isolated .qa-0421-assert-profile) secondary internal cases completed30327 exit0. Both qa-0421-assert-{overlay-controls,overlay-drag-open-guard}.log explicitly report qa acceptance passed=true failed=[] missing=[]. Immediate postdrag open suppressed/minimized=true; delayed deliberate open accepted/visible=true. Synthetic DOM/IPC only, no real pointer or compositor proof. No Spotify controls. Both test instances exited; no active handles. Shipped0.4.21 package does NOT include this QA-only strengthening; runtime fixes unchanged.

- 0.4.21 packages COMPLETE, build10381 exit0. Includes recent clock idempotence, revision33 short-word/exact-anchor and stronger-content selection fixes. Fresh extraction release/verified-0421-20260912-180300 passes extended verify-package.cjs. Asar SHA256b98172d9999526ade5d8ba9269c634e53926849f307d401bf0afd29e5b03f2d4. ZIP181092635 bytes SHA256F929CF1E0E22DA7DD63C6DF4E08E616EBB8BC7D7DD55F7237383548AD9FEB1BA; Setup134955923 bytes SHA2565E2CCCEA03F1E2B65E315E2B6CDA7747EEC72E21A8038488BF60C48FE94A5288.
- Secondary internal QA80425 exit0: hover visible/leave hidden, open-client, close/reopen all logged correct; lyrics-scroll3062->3242->3062 target3062.3 passed=true. qa-0421-{overlay-controls,lyrics-scroll}.log/png. Synthetic DOM/IPC, NOT physical click/drag acceptance. Spotify paused tayori 春を待つ99100ms unchanged. No existing Syllable processes found before QA, so none stopped; both QA instances exited and no persistent candidate launched. No active handles. Next actual secondary UI/compositor and audible synchronization verification using this candidate. Latest227 tests pass; full objective still incomplete.

- Latest SOURCE selection fix: reproduced Same Blue localized query selecting NetEase78%/595chars over available LRCLIB95%/597chars. bestLyricsCandidate's detailed-equivalent reopening used only >=.72 similarity and1.25x row count, overriding identity for a fragmented source missing さえ. Now detailed-timing reopening requires identical ordered normalized text (duration and row-count guards retained); real content holes/outliers still independently reopen. No song-specific patch or lyric replacement. New omitted-fragment regression fails before/passes after; existing exact-content finer-timing behavior preserved.
- FINAL227/227 passed (194 offline +33 online), session31373 exit0; production build57444 exit0, diff-check clean. Both Same Blue online checks pass unchanged. Prior failed32206/24036 are historical, not current failing state. Latest clock/idempotence/revision33/selection fixes remain SOURCE ONLY; running0.4.20 packages still oldrevision32. Next uniquely versioned candidate plus physical secondary UI and audible playback verification. No active handles, no Spotify controls this turn.

- SOURCE revision33: supplementalBuckets incorrectly reused similarity rows (length>=3), collapsing short-word Chinese into prior sentences. Now buckets include all parsed sung rows. Renderer/provider bucket exact timestamps and ownerAt exact timestamps take precedence over1200/200ms lead tolerances, preventing dense refrain shifts. Regression first reproduced dropped/merged short words and400ms ownership error. Final193 offline pass,33 online skipped; build13150 exit0. Running0.4.20 remains revision32 and lacks this plus clock idempotence fix. verify-package now requiresrevision33, so it intentionally rejects old0.4.20 for latest-source validation.
- Latest full online32206 EXIT1:225 pass,1 fail (before final ownerAt exact-priority). Same Blue localized-vs-original artist ordered text differs near repeated さえなれずに: one source has なれずに where other has さえなれずに. Preserve assertion; source selection/content repair still unstable. Next inspect provider diagnostics for both queries; do not claim full226 pass or package until resolved. No Spotify controls/UI operations this turn, no active handles.

- Post-package SOURCE clock fix: identical observation rebroadcasts previously repeatedly smoothed position (test11890 ->11800.0306 after10 duplicates). TransportClock now tracks raw observation identity and preserves once-corrected position while accepting metadata/duration. Pause/seek at same timestamp and reset still work. New regressions first failed then pass; production build47538 exit0, clock17 pass. Running0.4.20 does NOT include this source fix; do not overwrite its packages.
- Runtime read-only paused0.4.20 sample15.099s:4 exact-path responsive processes, CPU delta0.359375seconds, private memory398942208->382459904bytes (~380.46->364.74MiB). Not a long-play benchmark or comparison under identical visible windows. qa-0420-live.log reports overlay hidden at05:06:04Z; do not automatically reopen/undo potential user interaction. No Spotify commands or desktop interactions this turn. Need physical secondary UI and audible clock tests; objective remains active.

- Packaged0.4.20 revision32: build/ZIP/NSIS session82519 exit0. Fresh extraction release/verified-0420-20260912-010600/Syllable.exe passes extended verify-package.cjs (new translation ownership and revision32 markers). Asar SHA256878a1fc03881cf2930c7b3b60a7f81484f3fe5ff9304d860a2bb840dbc586685. ZIP181092476 bytes SHA25681A75B6028A3CB412E859902B070A769F4A98C6242B8BF92A69D306CA69E9E86; Setup134955769 bytes SHA25669BC65D71C4D1CBBF2615805FB68C53F2EF641B70B4D4EDD3D89798F10B61FF3.
- Internal packaged secondary QA session80912 exit0: overlay-controls hover/leave/open-client/close/reopen pass; lyrics-scroll3062->3242->3062 target3062.3 passed=true. Logs qa-0420-{overlay-controls,lyrics-scroll}.log. Synthetic DOM/IPC, NOT real pointer/desktop compositor acceptance. Spotify paused tayori 春を待つ99100ms, output244723/cue45430; no controls sent.
- Stopped only exact-path0.4.19 QA instances. Launched0.4.20 extracted candidate with isolated .qa-0420-profile, secondary-test, force-overlay, qa-0420-live.log using Hidden. Revalidate actual running processes/window; may need second same-profile Normal launch to expose main. No active build/test handles. Next physical secondary interactions and live bilingual bridge/audible synchronization validation. Latest222 tests fully pass; total objective remains incomplete.

- Revision32 source follow-up now FULL222/222 pass (189 offline +33 online), final session77131 exit0. Added inverse grouping: one owner sentence maps to <=4 contiguous base phrases only when concatenated normalized original equals it exactly and candidate is unique within surrounding monotonic anchors. Whole translation repeats only for a single owner translation row; split translation phrases retain separate offsets. Ambiguous repeated choruses stay unmapped. Same Blue original >30/Chinese >25 expectations pass unchanged. TypeScript and diff-check pass; production build passed during prior221 run after final code edits, but rebuild uniquely versioned0.4.20 before packaging to avoid ambiguity. No active handles.
- Remove prior source-WIP coverage blocker below: fixed and full suite rerun, NOT audible universal sync acceptance. Running0.4.19 package remains unchanged and lacks revision32/source renderer repetition fixes. Next create unique0.4.20 candidate, verify archive and secondary-display behavior, then inspect tayori live bilingual bridge and audible timing. No Spotify commands or desktop interactions this turn.

- SOURCE WIP revision32: supplemental remap now resolves translation timestamps to owner original rows and monotonic anchors; rejects unanchored divergent verses/extra choruses rather than median-offset extrapolation. Preserves delayed phrases and bounded (<=4) split-owner groups whose concatenated original equals one base row exactly. Three new regressions plus stronger extra-chorus assertion; latest provider77 tests pass and build exit0. Running package unchanged.
- Full online session9470 EXIT1 before final grouped-owner extension:218 passed,1 failed. Same Blue Chinese coverage18 rows vs >25 requirement. DO NOT weaken assertion or ship yet. Need support inverse grouping (one owner original sentence split across multiple base rows) with ordered text proof, not arbitrary repetition. Latest extension only handles many owner rows ->one base; rerun online after proper inverse mapping. No active test/build handles after5669 exit0.

- Post-package source fix: removed renderer's unproven translation continuation copying (up to two later rows). New divergent-bridge regression first failed, then passed; 184 offline pass, 33 online skipped; build exit0. Original split translation phrases still join within their owning interval; explicit repeated timestamps preserved. Tradeoff: unproven merged-sentence continuation now blank rather than copied. Running0.4.19 package does NOT include this change.
- Physical secondary main-window scroll succeeded using sky (window231476272): lyrics moved and return-current button appeared. Click at615,532 was dispatched but resulting capture was truncated, so return-current outcome is NOT verified. No Spotify controls used. Current observed tayori 春を待つ LRCLIB original bridge diverges from earlier NetEase original; Chinese repeated 不知不觉间走不动路了 across multiple rows. Renderer repetition addressed, but provider alignSupplementalTimeline still remaps unmatched rows via median delta: investigate owner-original correspondence before claiming bridge translation correct. Audible synchronization remains unverified.

- Full216/216 suite passed (183 deterministic +33 online); session58617 exit0. Build/ZIP/NSIS session89437 exit0. Latest memory and window-snapshot/broadcast fixes now packaged. Fresh extraction release/verified-0419-20260912-005000 passes scripts/verify-package.cjs; app.asar SHA256 e22b30a09b53864420a20955ab929187273202e8c4d6e3cdaa83b01a4e227447.
- ZIP181092097 bytes SHA256 19A8DA4D46522176171BF7BAD95E79F3EB48912A422D5AB606F4FEF27E2C4E88; Setup134955430 bytes SHA256 38DD1A1C6B147626EB5DAEDFEF43093F9E4C68C9205D97EC0CDF024785F4508E. README removed obsolete duration-ratio mapping and0.4.15 install recommendation, labels prior evidence historical.
- Packaged internal secondary QA session7379 terminal0: overlay-controls hover visible, leave hidden, open-client visible, close/reopen passed; lyrics-scroll3284->3104 for target3104.3 passed=true. Logs qa-0419-overlay-controls.log and qa-0419-lyrics-scroll.log. These are synthetic DOM/IPC, not physical pointer acceptance. No Spotify playback commands.
- Stopped only exact-path0.4.18 QA instance; launched0.4.19 from verified-0419-20260912-005000/Syllable.exe with isolated .qa-0419-profile, secondary-test, force-overlay and qa-0419-live.log. Revalidate processes and actual window before interaction. Next real secondary-pointer tests and actual cross-window null/large-library acceptance, performance and audible sync. No active build/test handles.

- Latest source-only sync fix reproduced with failing integration test first: subscription's else-if suppressed lyrics-view whenever library changed simultaneously. Now broadcasts distinct current/empty/transient view after library deltas, while skipping duplicate payload if exact current document was already sent by upsert. Integration covers null clear, normal one-copy save and transient view distinct from persistent library. Full183 offline passed,33 online skipped; build passed(session67703 exit0). Need0.4.19 or uniquely named candidate bundling all memory/snapshot/broadcast fixes, then true Electron window tests. Running0.4.18 remains older source. No active handles.

- Added useWindowSync.test.ts message/timer integration harness executing the actual hook effect with mocked React mounting, store and BroadcastChannel. Three cases verify null snapshot clears stale view and cancels800ms retries, stale snapshot continues retry until matching upsert, track change rearms and unmount closes channel/unsubscribes/clears timer. Targeted3 passed and TypeScript passed. This is NOT real Electron BroadcastChannel/Windows acceptance; source changes remain unbundled. No runtime changes or Spotify commands this turn.

- Latest source-only cross-window fix: snapshots now carry playback trackId. Matching explicit null documents clear stale views and acknowledge the empty state, stopping the800ms snapshot retry loop; mismatched/undefined documents cannot claim another song. lyrics-view null and matching upsert also stop retries; playback identity changes reset acknowledgement. Added identity/empty/stale/no-track regression.178 offline passed,33 online skipped; production build passed(session7091 exit0). Existing running0.4.18 lacks this and previous auxiliary-memory fix. Need hook-level timer/IPC integration plus rebuilt secondary-screen acceptance before claiming real-window behavior fully verified. No active tool handles.

- Latest SOURCE ONLY memory fix: auxiliary window snapshots/upserts no longer retain a duplicate whole-song library, only current lyrics; unrelated upserts are no-ops once auxiliary library is empty. Main library/user-edited documents unchanged. Added window-document helper regression (500 unrelated updates plus current replacement/primary preservation). Full offline177 passed,33 online skipped; production build passed before final no-op fast-path, final TypeScript and2 targeted tests passed. No active handles. Existing0.4.18 package does not contain memory fix.
- Actual paused0.4.18 sample:15.018s, four exact-path processes, CPU delta0.15625s, private258.418MB, all responding. This is baseline BEFORE memory fix and short paused sample, not claimed long-play memory improvement. No Spotify commands issued. Prior runtime and internal QA continue as below.

- 2026-09-12 00:39 packaged internal secondary-screen QA completed (session27717 exit0): overlay-controls hover visible/leave hidden, open-client visible, close hidden/reopen visible; drag-open immediate suppressed and later deliberate accepted; font widths64px for 晴る会行 at500/600/700/800; lyrics-scroll3284 ->3104 for target3104.3, passed=true; programmatic window move(-1263,716)->(-1173,680) preserved820x220. Logs/screenshots qa-0418-{overlay-controls,overlay-drag-open-guard,font-metrics,lyrics-scroll,overlay-drag-performance}.
- Inspected controls and overlay screenshots. Overlay PNG1230x330 four corner alpha values0 via System.Drawing. This establishes captured alpha, NOT physical desktop click-through/compositor ghosting. These QA scenarios synthesize DOM events and IPC/setPosition; they do NOT prove real pointer capture/lostcapture/physical click acceptance. Keep that next-stage acceptance outstanding.
- Stopped only the previously launched0.4.17 QA processes by exact path. After the five cases completed, launched0.4.18 candidate from release/verified-0418-20260912-003800/Syllable.exe with --syllable-secondary-test --syllable-force-overlay --user-data-dir=D:\Projects\spotify-lyrics\.qa-0418-profile --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0418-live.log. Spotify playback controls untouched. No active test handles. Next actual secondary display pointer tests, performance sample and audible sync verification.

- 0.4.18 full suite208/208 passed (175 deterministic +33 online); session6959 exit0. Build/ZIP/NSIS session61964 exit0. No active handles. Package includes revision31 credits, pointer lifecycle recovery, narrow header label, durationRatio diagnostic and honest timeline watermark.
- ZIP181091986 bytes SHA256 96D78A8DEEC0B433E003238A19071983266B57257EF12AA71C0B589AFCB08848; Setup134955237 bytes SHA256 C6355E71964E92DE9FAFC0A181DD96F3D7CE6D531BA6DEDC0338CE7998003EE7. Fresh extraction release/verified-0418-20260912-003800/Syllable.exe; extracted app.asar matches build SHA256 92278573E9C5C15B2CAF5C3BA7F984B8F3B4F8311B38849E45DB4F20DAC9229F.
- Added read-only scripts/verify-package.cjs. Run `node scripts/verify-package.cjs release/verified-0418-20260912-003800`; passed actual extraction. It verifies identity/code presence, NOT runtime behavior or audible sync. Candidate0.4.18 not launched yet;0.4.17 QA process remains running from verified-0417-20260912-002600 (last observed four responsive processes). Next replace only that QA instance with0.4.18, secondary-screen interaction/capture-loss/drag/font/credits acceptance, then resource and audible clock tests. Never manipulate Spotify during these UI tests.

- Latest source-only overlay fix: pointerup/cancel/lostcapture/blur/unmount/lock-change share finishPointerDrag, clear local ownership before sending end IPC and finish active movement at most once. Second pointers cannot overwrite a live drag. Main ignores duplicate starts, non-owner moves/end and inactive end events. Two deterministic lifecycle tests added; actual Windows drag acceptance remains unproven. Shortened connection badge and added single-line ellipsis to address observed narrow header wrapping. Final offline175 passed, online33 skipped; build passed (session86215 terminal0). These changes are NOT in running0.4.17 package.

- Source-only follow-up AFTER0.4.17 packaging: shared src/lib/lyric-metadata.ts recognizes precise engineering credits at any timestamp. Provider sanitization/scoring, renderer/import parsing and cached rendering share it. Cached supplemental rows exactly anchored to original credits are hidden without mutating storage. Revision31 refreshes auto-provider caches. Tests cover ordinary-text false positives and corrupt cached romaji.
- QA duration diagnostic renamed scale -> durationRatio (not an applied tempo); UI watermark now SPOTIFY TIMELINE rather than FRAME-ACCURATE CLOCK. Running0.4.17 package does NOT contain these source changes. Need uniquely named rebuild before claiming it does.
- Validation:173 offline passed,33 online skipped by default; original32 online cases passed plus newly added tayori 春を待つ credit case passed separately. Final build passed (session73568 terminal0); no active handles. Narrow connection badge wrapping and full overlay/audible tests still outstanding.

- 0.4.17 packaging finished exit0 (session33011). ZIP181091341 bytes SHA256 2F3FB12AB58276A7979C799C25C8CC03D357BB96AE47B671F865F40B60565D32; Setup134954726 bytes SHA256 AEC3718D208C52D72BBEE86671D71592DC378439E3FB83154C6F7962B17E8FA0. Asar version and latest provider code verified.
- Running candidate: release/verified-0417-20260912-002600/Syllable.exe, isolated .qa-0417-profile, secondary-test, force-overlay, qa-0417-live.log. Main screenshot/accessibility verified0.4.17 using sky window583863204 and exact candidate path. Secondary area(-1707,-44,1707,1020), scale1.5. Spotify remains paused at99100ms on tayori - 春を待つ. Provider97%, fetched three tracks in3155ms. No playback commands sent. Main rendering observed; overlay actual controls/alpha/drag NOT yet accepted.
- New visible QA bug: tail credits 母带工程师 / 混音工程师 become original lyrics and corrupt romanization with Han retained. Extend precise CREDIT_LINE role labels and tests next. Also connection badge wraps at narrow main width. QA log scale1.0648 is merely duration ratio, not applied scale1; rename misleading field. Latest package still has these defects.
- sky.launch_app unexpectedly opened the installed old executable despite candidate path. Those newly launched old processes were identified by exact path and stopped. Exact-path Start-Process with the same isolated profile then exposed candidate correctly. Do not use sky.launch_app for this candidate path again. No active build/test handles remain.

- 2026-09-12 00:21: Same Blue retrieval now passes both the existing >30 row/Chinese coverage test and exact ordered-content equality between localized and original-script artist queries, WITHOUT weakening assertions. Added title-only LRCLIB retrieval only for mixed Han/Latin artists; identity promotion requires identical >=8-character Latin skeleton, shared Han, exact title+album and duration within1.5s. No song-specific alias table. Deduplicated redundant LRCLIB search/get queries. First complete run192/192 passed.
- Then added an exact-get edition guard: cleaned Live/Acoustic queries cannot accept a contradictory studio payload simply because /get succeeded. Its new integration test passed; production build passed. Final full rerun session92384 finished exit0:193/193 tests passed (161 offline +32 real-provider cases). No active handles. Next package under0.4.17 or another unique version and secondary-screen acceptance, then audible synchronization validation. Existing0.4.16 package is still stale.

- Repository upload succeeded: initial source import 54c44b4 on origin/main, preserving original remote README history. Follow-up source revision30 cleans Kugou track headers using the provider-native title/artist (not the potentially localized Spotify spelling), and removes early short-form credit labels. Regression verifies real lyric phrases remain. Offline159 pass, online32 skipped by default; latest actual online Same Blue comparison still fails from repeated-clause differences. Continue source validation; no new installer launched.

- 2026-09-12 repository import: local folder initialized as Git, origin https://github.com/MachineWJQ6657/spotify-lyrics.git; original remote README commit preserved as parent. Only source/tests/build icons/docs tracked; local QA profiles, screenshots, logs, release outputs and checkpoints excluded. Git's configured localhost proxy was unavailable; use per-command `git -c http.proxy= -c https.proxy=` for network operations, without changing global proxy configuration.
- New Same Blue evidence: localized artist query sometimes chose Kugou Live at Stadium 2025 (243000 ms) while original-script artist fetched LRCLIB studio (237837 ms). Added edition mismatch rejection in search scoring and early downloaded Kugou track headers. After fix, localized query returned studio Kugou237871, not live243000. Added offline edition tests (158 offline now pass).
- The new online comparison test `compares Same Blue localized and original artist recordings by ordered text` currently FAILS deliberately: Kugou includes untranslated header/credits and omits three repeated clauses that LRCLIB includes. Existing Same Blue >30-row check is still pending. Next improve localized artist retrieval without hardcoded per-song aliases and investigate repeated clauses; do not mark full online suite green. Both targeted online commands finished; no active online handles.

- Latest source-only update 2026-09-12 00:11: Provider revision 29. Bansanka difference was NOT short standalone rows: four full rows omitted tandem repetitions (no rows under three characters in either provider). Added conservative repairRepeatedWords: two independent expanded rows, same-duration recordings within 2 s, >=.97 text similarity, stable anchors within 700 ms, >=80 confidence against100, only exact tandem expansions; conflicting variants and Spotify originals remain untouched. Preserve base timestamps, metadata, clearing rows. Offline tests cover these protections. Online Bansanka now validates >=574 normalized characters and all four repeated clauses, not 55 fragmented rows; exact 42-row timing retained.
- Removed unsafe whole-song duration-ratio scaling from src/lib/clock.ts. Endpoints alone cannot distinguish fades/edits from tempo. No speed recipe now means native 1:1 media position; explicit speed automation and calibration remain. New regression covers intro/middle/outro with a fade-only profile. This fixes a mathematical source of accumulating error, NOT proof of audible synchronization across songs. Previously inferred actual tempo changes without explicit metadata may still require another reliable reference.
- Validation: 156 offline passed, 31 online skipped. Real-provider run 30/31 passed; Same Blue remains the lone failure (26 long NetEase rows vs >30 assertion). DO NOT lower that expectation without normalized-text comparison with a second full source. Prior 26-row sample itself covers 92.96% of duration but completeness unproven. Latest source is not packaged/launched; existing 0.4.16 ZIP/installer lack transport, repeated-word and clock fixes. Diagnostics now cap the character LCS table at 1,000,000 cells.
- No active test handles: full online session 37461 finished exit1. Next: compare Same Blue against a second full recording-matched source; validate audible clock on secondary display; package with a unique new version after acceptance. Do not claim universal sync or all lyrics fixed.

- New diagnostic evidence (2026-09-12 00:04): Bansanka LRCLIB exact has 558 normalized characters in 42 rows; NetEase has 574 in 58 rows. Character LCS shows LRCLIB is a strict subsequence: left-only empty; NetEase-only 16 characters `ないない会い会いないないないない`. Similarity 0.98584, yet both isProvenIncomplete directions return false. timelineRows currently filters normalized length <3, a likely blind spot for these short repeats. Do not just lower minimumLines. Next investigate their row timestamps and add a constrained regression for short repeated content before altering selection.
- Added opt-in provider-content-comparison diagnostics (SYLLABLE_PROVIDER_DIAGNOSTICS=1; vitest --silent=false is required to see passing logs). Diagnostics include character LCS differences; this code is source-only and should be bounded/moved to a QA helper before shipping if large provider payloads are possible. Same Blue failing sample had only one available provider, so no cross-provider comparison yet. Latest targeted run both failures reproduced; no test handle remains active.

- Latest 2026-09-12 source-only change AFTER the candidate package: TransportGate now starts its 250 ms confirmation when a new identity is first observed, resets on empty/outgoing/other identity, and main-process callbacks verify the transaction id before confirming. Added interruption regressions. Offline 151 pass, 31 online skipped; production build passed. Existing 0.4.16 release artifacts DO NOT contain this last change and must be rebuilt into a new uniquely identified candidate before launch.

- 2026-09-12 update: packaging handle 12847 finished exit 0; portable ZIP and installer exist. Online rerun 81399 finished exit 1: 29/31 pass. Same Blue selected NetEase 78%, exact duration 237836, 26 long original rows and 26 Chinese/romaji rows, last 221094 ms (92.96% tail); no transient flag. Bansanka returned 42 rows against minimum 55. This may be grouping rather than missing content: compare full normalized text and ordered sections before changing thresholds. Preserve failing expectations until evidence supports a stronger content-based oracle. No handles remain active from those two commands.

- Provider revision 28. Prior 0.4.15 sections below are historical package evidence, not proof for this candidate.
- Fixed local Spotify auto-generated lyric IDs being mistaken for user imports merely because both start with local-. Automatic stale timelines now refresh, while explicitly edited tracks remain protected.
- Persist edit ownership across refreshes; cached romanization repair runs only on Japanese originals and respects user-owned romanization. Fallback enrichment no longer mutates a published array.
- Provider cache keys now include album; supplemental alignment uses monotonic LCS anchors; non-Chinese supplemental candidates prefer coverage over provider order. Sparse romanization cannot claim several original rows as covered.
- Pure-kanji metadata can use original lyric language to choose the Japanese grid. CSS smoothing is set to auto; a visible improvement on Windows is NOT established by this property change alone.
- Validation: TypeScript/build passed; offline 150 passed, 31 online skipped. Full online run: 180 passed, 1 failed (Same Blue returned 26 rows versus required >30). Isolated retry passed. Do not weaken the threshold or call this resolved without examining failing source data.
- Added source/transient/duration/text/coverage diagnostics to the Same Blue assertion for the next failure. Online rerun handle 81399 and packaging handle 12847 were active when this section was saved; poll those exact handles, inspect output/artifacts if absent.
- Internal drift of ±1–2 ms only establishes consistency of the sampled transport clock, NOT audible word/line accuracy. Audio/reference timing verification remains outstanding. The packaged 0.4.16 gate still measures time since command start; the latest source correction above is not yet packaged.
- Next: finish online failure investigation, inspect candidate package, perform secondary-display acceptance, save a new checkpoint. Do not claim that 0.4.16 has been launched or visually accepted without observing it.

If this Codex run is interrupted, continue from this file. Do not discard existing release/checkpoint artifacts or user data.

## Current 0.4.15 state

- Current executable: `release/verified-0415-final-20260911-113456/Syllable.exe`; launch only this or a newer verified extraction. Keep `release/verified-0413-final-20260911-004445/Syllable.exe` as the stable rollback.
- Current live launch: `--syllable-secondary-test --syllable-force-overlay --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0415-final-live.log`. All visual/interaction QA stays on the secondary display. Never pause, seek, skip, close, or otherwise manipulate Spotify.
- Source/EXE version is 0.4.15 and Provider/cache revision is 27.
- Offline suite: 141 passed, 29 online cases skipped by default. Full real-provider suite: 170/170 passed. TypeScript, production build, ZIP, NSIS installer, and clean extraction passed.
- ZIP SHA-256: `27D1753855DD8F673ACB0B1B33991D3F3355A5AD9DCF4AF8EAA86EEE53257B43`; installer SHA-256: `0F970120D853D9F23F555A98EA71B0612CAFD74A85DF8E4E64FA4A5C94F6F6CF`.
- Source-only checkpoint: `checkpoints/Syllable-0.4.15-source-20260911-114152.zip` (65 entries, no missing/extra/empty files), SHA-256 `4AF55D0E4FDA42F6D5D58E9A90AEA226B35EF6A930356DB901DCAC61E464072F`.
- Six clean-package secondary-display cases passed: main UI, overlay controls, drag/performance, drag-open guard, font metrics, and lyrics scroll/follow. Use `qa-0415-final-*` logs/screenshots. Scroll explicitly reports `passed=true`; overlay corners are fully transparent.
- Current playing-state 20.3-second sample: four processes, 1.172 CPU-seconds, 377.7 MB private commit after a 66 MB startup drop, 73.9 MB working-set drop, zero LevelDB changes, every process responsive, and no fatal/unresponsive/error log match.
- Live `ヨルシカ — エイミー` evidence: lyrics request began from a 212906 ms Spotify media item, returned 38 LRCLIB rows after 3408 ms, aligned NetEase Chinese and romanization to the primary timeline, and maintained ±1 ms clock drift.

## Most important fixes in 0.4.15

1. Async lyric ownership and partial-result safety
   - Renderer requests are keyed by track id, effective duration bucket, Provider context, and retry token. Every stage, including cached romanization enrichment, checks ownership before publishing.
   - Cached/provider originals render before Kuromoji finishes. Transient results broadcast to the overlay as memory-only `lyrics-view` state and never replace stable library data or user edits.
   - A token-owned map permits exactly one 12-second transient retry; stale cleanup cannot delete or rearm a newer retry. Manual/automatic retry bypasses the stable Provider cache only for the advancing retry generation.
   - After four seconds without a positive SMTC duration, the current identity can issue a durationless fallback. The clock treats unknown duration as unbounded instead of clamping progress to zero.

2. One transport transaction for every control surface
   - Main window, overlay controls, tray, next, previous, play/pause, and seek share a main-process `TransportGate`. A skip remains pending until a different non-empty identity is stable for 250 ms or the six-second watchdog releases it.
   - Previous atomically selects restart-at-zero when current position is above three seconds; its short lock prevents same-tick duplicates. Ambiguous native timeouts retain the transaction rather than trying another backend.
   - During a local skip, empty SMTC snapshots retain the last non-empty identity. Worker and UI optimistic state roll back only for their own failed transaction.

3. Expanded regression and package evidence
   - Nine deterministic transport-gate tests cover duplicate directions/backends/windows, settlement, timeout, failure ownership, and previous semantics. Local-worker tests cover empty-snapshot retention and failure rollback.
   - The real-provider corpus now includes Spotify-localized `Same Blue — Official鬍子男dism` at 237836 ms and asserts Japanese phrase/row/tail completeness plus NetEase Chinese coverage.
   - Final source build: main 134.70 kB, local Spotify chunk 38.04 kB, preload 3.39 kB, renderer usePlayback 68.94 kB, App 101.64 kB.

## 0.4.14 historical state

- Current executable: `release/verified-0414-final3-20260911-105611/Syllable.exe`; launch only this or a newer verified extraction. Keep 0.4.13 as the stable rollback.
- Current live launch: `--syllable-secondary-test --syllable-force-overlay --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0414-final3-live.log`. Perform all visual/interaction QA only on the secondary display and never manipulate or stop Spotify.
- Source/EXE version is 0.4.14 and Provider/cache revision is 27.
- Offline suite: 122 passed, 28 online cases skipped by default. Full real-provider suite: 150/150 passed. TypeScript, production build, ZIP, NSIS installer, and clean extraction passed.
- ZIP SHA-256: `C7BEB9DB2F0D8E313752D7090CA0E37E09AEA9E9B523405A9DA03E27A2ECC123`; installer SHA-256: `167A1D1279217D8C19E727EF4F74C48F41026CA22277EF50768A463CE9AA873F`.
- Source-only checkpoint: `checkpoints/Syllable-0.4.14-source-20260911-110147.zip` (63 entries, no missing/empty files), SHA-256 `22DA76A1F37C1970B1869CC56B45740A8E75FFC90DA99EDD41036319CCEF5919`.
- Six final-package secondary-display cases passed: main UI, overlay controls, drag/performance, drag-open guard, font metrics, and lyrics scroll/follow. Use `qa-0414-final3-*` logs/screenshots.
- Final paused-state 15.2-second sample: four processes, 0.156 CPU-seconds, 381.8 MB private commit after an 81.7 MB startup drop, 78.6 MB working-set drop, zero LevelDB changes, every process responsive, and no fatal log match.

## Most important fixes in 0.4.14

1. Provider completeness under failure
   - All community/official requests share a 5.5-second generation budget that aborts both the active fetch and retry waits.
   - A generation with any community-provider failure may be displayed immediately but is not remembered as stable. The renderer retries once after 12 seconds only if track/context/document are unchanged.
   - Mixed outcomes inside one provider are no longer misclassified: an empty successful query cannot hide a sibling 429/503/timeout and permanently cache a partial language set.

2. Generalized timeline selection and queue boundaries
   - An LRCLIB exact-metadata timeline can be rejected when it is shifted by at least 2.5 seconds from two complete timelines that agree within 1.2 seconds, proven with at least four ordered text anchors spanning 30 seconds. Spotify official timing remains authoritative; one opponent or sparse repeated anchors are insufficient.
   - A next-track duration quarantined under the outgoing title can be adopted by a zero-duration replacement title only within 2.2 seconds, with both reported positions at or below 2.5 seconds and a valid duration of at least 15 seconds.
   - Natural final run `ランタノイド → Thirsty, Anxiety`: identity at `05:19:49.603`, request at `49.926` (323 ms), lyrics ready at `51.800` (1.874 seconds), one request, drift ±1 ms.

3. Lyrics follow and corpus
   - Before the first timestamp, `activeLineIndex=-1` now maps explicitly to scroll target zero. Explicit “return to current lyric” is synchronous and no longer relies on an rAF that Chromium may suspend in a background window.
   - Deterministic tests cover pre-roll, exact first timestamp, centering, top clamp, and missing-row semantics. Final packaged QA restored 684 to 504 for a 504.3 target and hid the button; the originally observed 180-at-pre-roll failure now resolves to target zero in the shared tested helper.
   - Real corpus includes `タイムグラム`, `君という神話`, `ランタノイド`, and `Thirsty, Anxiety`. `ランタノイド` protects normalized text and >.85 tail coverage rather than assuming 45 split rows are more complete than 36 grouped phrases.

## 0.4.13 historical state

- Current executable: `release/verified-0413-final-20260911-004445/Syllable.exe`; launch only this or a newer verified extraction. The latest 0.4.12 extraction is a stable rollback point but still waits for private transition metadata before requesting lyrics.
- Current live launch: `--syllable-secondary-test --syllable-force-overlay --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0413-final-live.log`. Continue all visual/interaction QA only on the secondary display, and do not stop Spotify.
- Source/EXE version is 0.4.13 and Provider/cache revision is 26.
- Offline suite: 111 passed, 24 online skipped by default. Full suite with real providers: 135/135 passed. TypeScript, production build, ZIP, and NSIS installer passed.
- ZIP SHA-256: `737E5DF884BCFA7D866F4DA417CA198C2535735FCD0C3EC77649A4E0E4EA47E7`; installer SHA-256: `2F622C79C914DEF380E091CC87C2FBCEA0E00E6A0FD6B4D153261B791C467C55`.
- Source-only checkpoint: `checkpoints/Syllable-0.4.13-source-20260911-005005.zip` (61 entries), SHA-256 `D066E6FF323EF759B859B5DE95356E6101E159ED32D96EBECF3190E26EE3B584`.
- Packaged QA passed for main UI, controls, drag, font metrics, and lyric scroll/follow. Use the `qa-0413-final-*` logs/screenshots.
- Latest stable 12.02-second sample: four processes, 0.751 CPU-seconds (6.25% of one core), 380.9 MB private commit with −15.1 MB delta and −18.9 MB working-set delta, zero LevelDB changes, all processes responding, and no fatal log matches.

## Most important fix in 0.4.13

- Provider lookup no longer waits for private Spotify transition discovery once a positive SMTC duration exists. It enters the existing 320 ms coalescing window immediately.
- Safety is retained: track identity or the two-second duration bucket is an effect dependency, so later metadata cancels the stale renderer result; `sourceDurationMs` also changes the provider/cache key when a Mix recipe resolves.
- Real natural-boundary evidence (`The City Where Whales Fall` → `Paradisus-Paradoxum`): new identity at `04:44:12.627`, request at `12.953` (326 ms), private transition timeout at `14.596`, one request total, lyrics ready at `15.692` (3.065 seconds into the song).
- Offline 111/111 and full online 135/135 passed. The final package also passed all five secondary-monitor QA scenarios.

## 0.4.12 historical state

- Verified rollback executable: `release/verified-0412-final-20260911-003131/Syllable.exe`.
- ZIP SHA-256: `E9E589E0B28E154DF608B2AAD7433D83BA2316520E3C06268A343D281F696E99`; installer SHA-256: `E1DBC7717D5E064E9802EE0FB3A282CE8215B99AB4C758DE6DEDF8C5A075BC9E`.
- Source-only checkpoint: `checkpoints/Syllable-0.4.12-source-20260911-003750.zip` (61 entries), SHA-256 `6F5A074A8CADCB094E1648A424E1492BB2BE159245137468B557EA66DC700D6D`.

## Most important fixes in 0.4.12

1. Cross-language provider discovery
   - Normal title/artist queries run first. NetEase searches a wider 50-result artist page only when the first result is absent, below 88%, or differs from Spotify duration by more than 1.2 seconds.
   - A local kana fold makes katakana metadata comparable with Spotify's Latin artist string without loading the full romanization package in the main process.
   - For a title with no shared characters, exact millisecond duration becomes a conservative release fingerprint and loses identity score quickly over a 2.5-second window.
   - Live observed failure `HIBANA — Fading Sparks and Summer Sky` now resolves to NetEase's `消えゆく火花と夏の空 / ヒバナ`, exactly 223604 ms, with 27 meaningful Japanese rows plus synchronized Chinese and romanization.
   - A title+album pair can no longer manufacture artist identity without independent artist evidence. `RADWIMPS — Suzume` rejects the 240000 ms Russian cover, checks the artist page, and selects the 238560 ms soundtrack entry rather than the 236390 ms single.
   - When identity, text, and completeness are otherwise equal, duration is only a final tie-breaker. A healthy top identity also remains protected from a candidate six points lower whose only advantage is more fragmented lyric rows.

2. CJK line layout
   - Main and overlay primary lyrics use Chromium balanced wrapping. It prevents tiny CJK orphan lines while leaving font size, equal glyph advances, timestamps, and transport mapping unchanged.

3. Verification
   - Five final-package secondary-display QA scenarios passed. The deterministic controls run moved the actual cursor to unused secondary-display space before checking the 600 ms hide delay; lyric browse/follow moved 2170 → 2350 → 2170.
   - Final package preserves 820×220 through drag and `[64,64,64,64]` equal CJK advances for weights 500/600/700/800.

## 0.4.11 historical state

- Do not restart from the old 0.4.10 artifact. The current verified executable is `release/verified-0411-final-20260910-234232/Syllable.exe`.
- It is launched with `--syllable-secondary-test --syllable-force-overlay --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0411-final-live.log`; preserve the user's requirement to test UI/interaction only on the secondary display and do not stop Spotify.
- Source version is 0.4.11 and lyrics Provider/cache revision is 25.
- Offline result: 107 passed and 22 online cases skipped by default. Full online result: 22/22 passed. Production build and Windows packaging passed.
- Final ZIP: `release/Syllable-0.4.11-Portable.zip`, SHA-256 `C9A92C91DAED3464703DE6CB701845547A0E7E1A34B78A417BA383CECC0D3449`.
- Final installer: `release/Syllable-0.4.11-Setup.exe`, SHA-256 `9D9051C8848236998FD06C665A2DB0BC3ED6D64A28A8B497EE18C26D1D382D8E`.
- Source-only continuation checkpoint: `checkpoints/Syllable-0.4.11-source-20260911-000111.zip` (61 entries), SHA-256 `D434E8B78F486FE6F3F6F0E86A8CF77D1F07B655404776ED89E1D0F9620F21A8`. It excludes dependencies, release binaries, build output, screenshots, logs, and temporary profiles.
- Five packaged secondary-monitor QA cases passed: main UI, overlay controls, overlay drag/performance, font metrics, and lyrics scroll/follow.
- Latest final-package 18-second playing sample: four processes, 0.781 CPU-seconds (about 4.34% of one core), 369.5 MB private commit, +0.2 MB working set, and zero LevelDB file changes. Earlier development build after the 160 ms main refresh change used 0.422 CPU-seconds in 18 seconds.

## Most important fixes in 0.4.11

1. Startup and track-boundary ownership
   - The first already-playing SMTC position is held for at most 3.2 seconds; an authoritative raw-clock correction releases it after 180 ms.
   - A large duration change under the same title is quarantined until repeated confirmation or a verified Mix endpoint. Near-zero next-track position no longer resets the outgoing track.
   - Natural boundary evidence: `カラカラ` switched after about 694 ms, `ブルーバード` after 441 ms, and `ASCA — CHAIN` after 654 ms. Each new media item issued one provider request with its own duration.

2. Complete and plausible lyrics
   - Stable cross-provider anchors now treat two short repeated outro rows spanning at least eight seconds and six characters as real missing content. `カラカラ` ends with all three `やれるわ` rows and tail coverage above 0.95.
   - `durationPlausibleForPlayback` rejects a result when its absolute duration delta exceeds 12 seconds and its ratio falls outside 0.82–1.18. The gate runs before provider-local selection and again before cross-provider merge.
   - This blocks the observed 376693 ms wrong `HIBANA — Untrue` edit from being scaled onto the 207744 ms Spotify item.
   - Empty/transient provider results are not remembered as successes, and the UI exposes manual retry.

3. Performance and interaction
   - Main-client transport repaint moved from 100 ms to 160 ms while the always-visible overlay retains 80 ms.
   - Overlay controls are driven by enter/leave/drag events rather than a permanent global cursor poll.
   - Auxiliary renderers do not hydrate the full persisted lyrics library; cover payloads and repeated hit-region IPC are deduplicated.
   - Final QA kept overlay size at 820×220 after moving from `(-1263,716)` to `(-1173,680)`. Controls hover/show/hide/open/close/reopen, font metrics, and lyrics scroll/follow all passed.

## 0.4.10 historical state

- Source, tests, production build, Windows ZIP/installer, clean extraction, secondary-monitor QA, real Spotify lyric comparison, and performance sampling are complete.
- Current executable: `release/verified-0410-final-20260910-195900/Syllable.exe`.
- Current launch mode: `--syllable-secondary-test --syllable-force-overlay --syllable-qa-log=D:\Projects\spotify-lyrics\qa-0410-final-live.log`.
- Spotify was restored to `ヨルシカ — 言って。`, paused at about 71.270 s after QA. Do not stop Spotify.
- Offline result: 89 passed, 16 online tests skipped by default. Online result with `SYLLABLE_ONLINE_QA=1`: 16/16 passed.
- Final ZIP SHA-256: `56770224A9566D26E49891C68DC95F9A3D6786307F334E9ABAE94E6DE29FEE4F`.
- Final installer SHA-256: `851243A54453DF8D2DEF70419AD6C2332EE2BD46168CE7416789AAA21AEC0B90`.
- Final source checkpoint: `checkpoints/Syllable-0.4.10-source-20260910-200619.zip` (67 entries), SHA-256 `05FD091DA41C68650FAA06F1C16B406EB0417EC3BA9CF6AF82B856948BDE41F4`.
- Lyrics provider/cache revision is 21.

## Most important fixes in 0.4.10

1. Current-song content/source correction
   - `ヨルシカ — 言って。` now selects the 48-row `LRCLIB · 精确匹配` timeline instead of the 53-row Kugou search result that gained score only by splitting identical phrases more finely.
   - Exact metadata is a trust signal, never an unconditional override: stable cross-provider anchors still reject an exact candidate with a proven missing prefix, bounded middle block, or suffix.
   - Early timed `artist - title`/labelled metadata is stripped without deleting a real title refrain.
   - Spotify's visible official lyrics (38 grouped rows) and the selected LRCLIB timeline (48 split rows) normalize to the same 458 characters exactly.
   - During a bounded live playback check, all 12 sampled provider-active rows were contained by Spotify's white official-highlight row. Spotify was restored to paused at 71.270 seconds afterward.
   - NetEase Chinese remains a separate translated timeline; all unique delayed phrases falling in one main-line interval are retained in order instead of overwriting each other.

2. Playback-only persistence and auxiliary IPC
   - Zustand persistence now compares the persisted `settings` and `library` references before JSON serialization. Playback/connection/editor ticks no longer serialize and write the entire lyrics library.
   - Genuine settings and library changes still persist immediately; an isolated unit regression verifies both branches.
   - Initial playback sent to the controls renderer now strips embedded cover Base64 just like the lyric overlay.
   - Chromium performed one normal startup LevelDB compaction, then a second 25-second stable sample produced zero file size/timestamp changes.

The following 0.4.9 mechanisms remain active and were revalidated:

3. Track-boundary ownership barrier
   - `src/hooks/usePlayback.ts` rejects zero duration and all unresolved local Spotify metadata, then waits for a 320 ms quiet period.
   - `electron/spotify-transition.ts` will not validate a Mix recipe with `duration_override` against a title-only zero-duration SMTC snapshot.
   - A real regression formerly requested `Vaundy — Tokimeki` with the previous song's 242182 ms. The final live log requests it only after stabilization with 233081 ms.

4. Correct-version selection and cache invalidation
   - Album-aware scoring keeps track/artist identity dominant and no longer rewards a wrong compilation just because it is closer to a custom Mix endpoint.
   - The live Tokimeki metadata is album `Tokimeki`, SMTC 233081 ms. Final provider selection is NetEase 97%, matched duration 212000 ms, 65 lines.
   - Revision 21 forces documents cached before the latest scoring/completeness rules to refetch.

5. Generalized lyric-clock fallback
   - Spotify position remains the only transport and is never overwritten or sought from a lyric duration.
   - Valid Spotify speed automation is integrated piecewise; cue points remain diagnostic and fade endpoints never become source duration.
   - When the private state file is stale/unavailable, `lyricSourcePosition` applies a conservative 0.82–1.18 duration ratio only to high-confidence attached lyrics and only when the difference is at least 2%.
   - Tokimeki maps 233081 ms transport to 212000 ms lyrics (0.9096×). Final screenshot shows `时长校准 · 0.910×` while the player remains 1:40 / 3:53.

6. Bilingual and completeness repair
   - Interleaved Japanese/Chinese LRC is split using dedicated translation timestamps or repeated 180–8500 ms adjacent script pairs.
   - Kana-title tracks prefer a plausible Japanese original rather than a dense Han-only translation.
   - Decorative `♪` rows do not fake completeness; stable cross-provider anchors detect missing prefix, bounded middle blocks, and suffix.
   - NetEase Chinese remains preferred when near the best coverage. A translation sentence can carry across two nearby split source rows but never across a long instrumental gap.
   - `ヨルシカ — 言って。` at 71.270 s shows `あぁいつか人生最後の日`; Japanese, romanization, and Chinese remain separate.

7. Interaction/font/performance
   - Overlay controls are an independent native Tool Window. Transparent blank pixels pass through; the four PNG corners have alpha 0.
   - The empty-session gap after next/previous does not release the skip lock. A single real next emits one command and advances one item.
   - Post-drag open-client clicks are suppressed; a deliberate click after 700 ms succeeds.
   - Yu Gothic Regular/Medium/Bold replaces forced MS Gothic. At 150% DPI, weights 500/600/700/800 all measure `[64,64,64,64]` for four CJK glyphs.
   - Final paused 10-second initial sample: four Electron processes, zero measured CPU increment and 273.5 MB private commit. A following 30-second sample used 0.203 CPU-seconds while private commit fell 2.96 MB and working set fell 2.70 MB; there is no continuing growth. The renderer is shared across all three windows; Kuromoji uses a one-shot worker.

## Final evidence

- Current-song source/content: `qa-0410-final-live.log`; selected LRCLIB exact, 48 rows, NetEase romanization/Chinese, matched duration 242000 ms.
- Extended live-provider corpus: 16/16, adding `風のアンセム`, `夏が来るたび`, `ステレオタイプライター`, `Prologue`, `Bubble`, `靴の花火`, `盗作`, and `太陽`. `Bubble` verifies the no-synced-LRCLIB NetEase fallback.
- Packaged controls: `qa-0410-overlay-controls.log` / `.png` (open, close, reopen all succeed).
- Packaged drag: `qa-0410-overlay-drag-performance.log` / `.png` (90×−36 logical-pixel move, size remains 820×220, then restores).
- Packaged fonts/main UI: `qa-0410-font-metrics.log` / `.png` (all four CJK glyph advances equal at all four weights).
- Real boundary/source log: `qa-049-final3-live.log` (233081 ms request, 212000 ms result).
- Duration mapping UI: `qa-049-final-timeline-main.png` and `qa-049-final-timeline-overlay.png`.
- Duration mapping logs: `qa-049-final-timeline-main.log`, `qa-049-final-timeline-overlay.log`.
- Font: `qa-049-final4-font-metrics.log` / `.png`.
- Controls: `qa-049-final4-overlay-controls.log` / `.png`.
- Drag/open guard: `qa-049-final4-overlay-drag-open-guard.log` / `.png`.
- Earlier same-version drag performance and scroll checks: `qa-049-final-overlay-drag-performance.log`, `qa-049-final-lyrics-scroll.log`.
- No 0.4.10 QA or live log contains `unresponsive`, `renderer gone`, `worker failure`, `fatal`, `uncaught`, or `error`.

## Files changed in the 0.4.10 pass

- `electron/lyrics-provider.ts` and tests: exact-identity quality signal, timed track-metadata removal, interval-based multi-phrase translation buckets, and current-song online regression.
- `src/store/useAppStore.ts` and tests: reference-deduplicated persisted storage; auxiliary renderers use a direct no-op in-memory adapter.
- `src/hooks/usePlayback.ts`: cache revision 21.
- `electron/main.ts`: strip cover payload from initial controls snapshot.
- `src/components/InfoView.tsx`, `src/components/LibraryView.tsx`: script-aware CJK metadata styling and accurate provider wording.
- `package.json`, `package-lock.json`, `src/components/Titlebar.tsx`: 0.4.10 version.

## Files changed in the 0.4.9 sync pass

- `electron/lyrics-provider.ts` and tests: identity scoring, interleaved translations, script preference, prefix/suffix/middle completeness, meaningful-row statistics.
- `src/lib/lyrics.ts` and tests: secondary sentence carry across split source phrases.
- `src/hooks/usePlayback.ts` and tests: revision 20, zero/unresolved duration gate, stable request delay.
- `electron/spotify-transition.ts` and tests: positive native-duration validation for Mix recipes.
- `src/lib/clock.ts` and tests: safe provider-duration lyric mapping without transport mutation.
- `src/App.tsx`, `src/Overlay.tsx`, `src/components/InfoView.tsx`: use and expose the selected timeline mapping.
- `electron/local-spotify.ts`, `src/OverlayControls.tsx`, `electron/main.ts`: nonempty replacement skip lock and stronger QA logs.
- `src/styles.css`: Yu Gothic unicode-ranged real-weight faces and equal CJK advances.
- `scripts/restore-spotify-qa.cjs`, `scripts/inspect-spotify-transition.mjs`: bounded live QA helpers.

## Safety and future work

- Preserve `checkpoints/Syllable-0.4.10-source-20260910-200619.zip`; it is the current source-only continuation checkpoint and excludes `node_modules`, `release`, `out`, screenshots/logs and temporary profiles.
- Preserve `checkpoints/Syllable-pre-sync-fix-20260910-0135.zip` and all 0.4.8 checkpoints.
- Previous source-only checkpoint: `checkpoints/Syllable-0.4.9-source-20260910-193400.zip` (58 entries, 229097 bytes), SHA-256 `79DF4469968566EBEB9F3CCBE97297372D15EEF1BB07FBA9229B304344BD7C3D`; it excludes `node_modules`, `release`, `out`, screenshots/logs and temporary profiles.
- Continue visual testing only on the secondary display unless the user changes that instruction.
- The Spotify restore file can remain on the previous song for several seconds; never apply a mismatched private profile. The bounded duration ratio is the safe fallback.
- Machine translation into arbitrary languages remains future work. Existing online translations and imported LRC/TXT are supported now.
- Third-party providers can fail temporarily. Do not cache network failure as permanent no-lyrics; retain search/import/manual timing fallbacks.

## Previous checkpoints

- `checkpoints/Syllable-0.4.8-source-20260910-180352.zip` — SHA-256 `2125E5734618B365AA1A4CE52465EA3EF7CC85D52F14BC0ACE51453B9D6B3082`.
- `checkpoints/Syllable-0.4.8-source-20260910-181220.zip` — SHA-256 `74E238D1F3909960AE7E8A23A1970A7A6B6F6A32F438144BB69DDB0304C45377`.
- `checkpoints/Syllable-0.4.8-source-20260910-181831.zip` — SHA-256 `3D802DD72C6135A6AD27C60C68D62ED463E8998CD36FFF1CD4592F661C6308B6`.
