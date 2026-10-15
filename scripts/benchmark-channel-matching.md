# Channel matching benchmark

For the before/after comparison of the October 15 fork fixes, see
[Recent fork changes](#recent-fork-changes-2026-10-15) below. The original
tables compare an older normalization optimization, not those fixes.

## Scope

The scripts compare a frozen copy of the pre-optimization scorer with
`prepareChannelMatchCandidate` and `getPreparedChannelMatchConfidence`
imported from core. The Channels route now reuses prepared candidates for
auto-matching and alternatives. Running the scripts does not modify
configuration, provider data or production.

The prepared scorer normalizes names, aliases, IDs, categories and optional metadata
once per candidate. It removes repeated normalization and one redundant Dice
similarity calculation, retaining the current score and metadata bonuses.
Both implementations still examine every pair. No candidate index or pruning
is used, so this measures preprocessing rather than a new matching algorithm.

The script also times computing alternatives for one channel from prepared
data. This is a CPU measurement of on-demand scoring, not an implemented UI
or API integration. That timing excludes preparing the full candidate set.

## Method

- Deterministic synthetic inputs, not the user's actual provider configuration.
- Names include channel brands, regions, numeric identifiers, quality markers,
  typos, unrelated entries, aliases and partially populated TVG IDs.
- Optimized scorer imported from source; baseline frozen before the refactor.
- Both timed paths allocate the same score matrix.
- Three small warmup passes; current/prepared timing order alternates per repeat.
- Prepared timing includes preparing both candidate sets on every repeat.
- Every score is checked with exact equality, outside the timed sections.
- On-demand scores are also checked against the corresponding baseline row.
- An additional 2,116-pair differential check covers empty/short names,
  accents, HTML entities, aliases, shared IDs and metadata normalization.

These are local CPU measurements, not full `/catalogs/channels` requests.
Validation, manifests, catalog pagination, XMLTV parsing, database access,
network latency, mapping assembly, rejected/assigned candidate filtering,
JSON serialization, browser rendering and cache behavior are not measured.
Synthetic all-pair inputs can do more work than a real configuration where
the route skips candidates already assigned or hidden.

## Results

Host: Windows, Intel Core i5-1235U, Node v24.15.0.

| Channels | Stream candidates | Pairs/pass | Repeats | Current   | Prepared, including setup | Speedup |
| -------- | ----------------- | ---------- | ------- | --------- | ------------------------- | ------- |
| 128      | 200               | 25,600     | 3       | 2.177 s   | 0.115 s                   | 19.0x   |
| 512      | 800               | 409,600    | 3       | 39.312 s  | 1.931 s                   | 20.4x   |
| 1,287    | 2,000             | 2,574,000  | 1       | 209.282 s | 12.519 s                  | 16.7x   |

The first two rows are medians; the largest row is a single observation,
not a stable median or a statistical confidence interval. Individual
current/prepared timings in milliseconds:

- 128x200: 1676.319/113.561, 2190.247/115.804, 2177.427/114.640.
- 512x800: 39311.528/1930.910, 35808.057/1915.080, 47412.116/2170.880.
- 1287x2000: 209281.841/12519.392.

One-channel alternatives took a median of 1.538 ms against 200 candidates and
5.476 ms against 800 candidates, excluding candidate preparation. Full-set
preparation medians were 4.979 ms and 27.001 ms respectively.
For the largest scenario, preparation took 40.974 ms and one-channel
alternatives took 15.615 ms. All 3,881,716 checked scores matched exactly
(scale repetitions plus the extra edge-case differential check).

The initial three-repeat run was interrupted after completing the first two
sizes, then the largest size was run separately with one repeat. Smaller
timings were obtained before adding the extra edge-case check; the scoring
prototype and generated scale inputs did not change. No compilation or other
benchmark ran concurrently with the timed work.

## Reproduce

```powershell
pnpm exec tsx scripts/benchmark-channel-matching.ts
```

Select sizes and repeat count for a shorter or targeted run:

```powershell
$env:BENCH_SIZES = '1287x2000'
$env:BENCH_REPEATS = '1'
pnpm exec tsx scripts/benchmark-channel-matching.ts
```

The script emits JSON progress/results to standard output and makes no network
requests. Default execution performs three repetitions of each size and can
take several minutes. A failed exact-score assertion exits unsuccessfully.

## Interpretation

Prepared data is now used by the Channels route. Exact scores preserve
scoring semantics on these fixtures, but do not constitute full route or UI
regression coverage. Do not claim a corresponding speedup for the entire page.

The route-shaped follow-up below separates parse, auto-match, per-channel
alternatives and JSON serialization. It still uses generated catalogs rather
than a live user configuration. Discovery reuse, lazy alternatives, candidate
indexes and list virtualization require implementation and separate
end-to-end validation.

## Route-shaped phases

`scripts/benchmark-channel-matching-route.ts` mirrors `/catalogs/channels`
after sources have been fetched: XMLTV channels stay as catalog rows,
M3U entries are treated as stream-only candidates, Pass 2 auto-matches each
stream onto existing channels, then `availableStreamSources` scores unused
streams per channel. This script uses the production prepared scorer, but
mirrors route assembly rather than issuing an HTTP request to Express.

This is the expensive matching shape (EPG catalog + stream-only playlist).
An M3U that also contributes catalog rows binds its own ids and skips Pass 2.

Collection here is `parseXmltvData` + `parseM3u` on generated IPTV-like
text (provider prefixes, quality markers, accents, partial TVG ids, two
programmes per channel). It does not include HTTP, `validateConfig`,
manifest fetch, catalog pagination, addon timeouts or browser rendering.
There is no checked-in live user configuration to replay.

### Results

Same host as the kernel table. Default sizes omit 1,287×2,000 because the
route scores auto-match and alternatives, about 1.86× the kernel pair count.

| Phase                              | 128×200 | 512×800   |
| ---------------------------------- | ------- | --------- |
| XMLTV+M3U parse                    | 56 ms   | 176 ms    |
| Auto-match, current                | 3.651 s | 51.096 s  |
| Alternatives, current              | 4.299 s | 51.187 s  |
| Matching total, current            | 7.679 s | 105.153 s |
| Matching, prepared including setup | 0.414 s | 6.184 s   |
| JSON.stringify                     | 6 ms    | 31 ms     |
| Matching speedup                   | 18.5×   | 17.0×     |

Both rows are medians of three repeats. Pair counts and payload sizes:

- 128×200: 22,144 auto-match + 25,400 alternative pairs (47,544 total);
  173/200 streams mapped; 1,417 alternatives kept; JSON 207 KB.
- 512×800: 353,280 + 408,800 pairs (762,080 total); 690/800 streams mapped;
  23,156 alternatives kept; JSON 2.87 MB.

Individual current/prepared matching totals in milliseconds:

- 128×200: 7521.764/397.603, 7679.410/414.364, 8275.242/478.002.
- 512×800: 105153.439/6183.706, 98708.545/5840.209, 109880.496/6266.158.

Preparation medians were 9.273 ms and 27.776 ms. Every assembled mapping
and alternative confidence matched the current scorer exactly.

### Reproduce

```powershell
pnpm exec tsx scripts/benchmark-channel-matching-route.ts
```

```powershell
$env:BENCH_QUICK = '1'
$env:BENCH_REPEATS = '1'
pnpm exec tsx scripts/benchmark-channel-matching-route.ts
```

```powershell
$env:BENCH_SIZES = '1287x2000'
$env:BENCH_REPEATS = '1'
pnpm exec tsx scripts/benchmark-channel-matching-route.ts
```

The default run is two sizes and three repeats and can take several minutes.
A failed exact-score assertion exits unsuccessfully.

### Interpretation

On these fixtures, matching is the scan cost. Parse and JSON stay well
under 200 ms while current matching is 7.7 s and 105 s. Alternatives cost
as much as auto-match because each channel still scores every stream not
already mapped to that same channel.

The route therefore does almost two all-pair passes, which is why these
matching times are higher than the kernel table at the same channel/stream
counts. Prepared data still speeds that work by 17–18× and keeps scores
identical, so it is the right first production change. An index is not
required to make collection or serialization the next bottleneck at 512×800.

The tables above record the original prototype measurements. A follow-up
run against the implemented scorer (one repeat, 128x200) measured matching
at 4.380 s before and 0.383 s after, including preparation (11.4x).
All 47,544 comparisons produced identical assembled bindings and alternatives.
The focused Express route tests also cover EPG on/off, disabled auto-matching,
rejected alternatives and one preparation per candidate per request.

A follow-up kernel run (one repeat, 512x800) measured 21.102 s before
and 0.931 s after, including preparation (22.7x). All 409,600 scale scores
and 2,116 edge-case scores matched exactly. These single-repeat follow-ups
verify the implemented scorer; timings vary with host load and warmup.

These numbers are still not a wall-clock for the Channels page: they exclude
network, manifests, auth and React rendering of a multi-megabyte payload.

## Recent fork changes (2026-10-15)

Compared the actual implementations from `41bbdfa7370ed38eb8525aae17fb25194b2b8519`
(before all three fork-fix commits) with the working implementation after
`1a70fff2`, including the pagination refinement found during this benchmark.
No merge, checkout, provider configuration or production data was changed.

The dedicated runner is `scripts/benchmark-fork-improvements.ts`. It reads the
historical source with `git show`, imports isolated temporary copies of the
before/after scorers, Express handlers and fetchers, and removes those copies
after the run. Shared dependencies are unchanged between these revisions.

### Method and limits

- Windows, Intel Core i5-1235U, Node v24.15.0; five measured repetitions.
- Before/after order alternates within each repetition. Small matching warmups
  precede kernel measurements; each HTTP/fetch scenario has an untimed warmup.
- Matching includes candidate preparation on every pass and examines every
  pair. Names include brands, alphabetic station labels, aliases, quality
  markers and metadata. Three distributions exercise distinct channel numbers,
  no numbers, and the same number on every channel.
- HTTP results use the real `/catalogs/channels` handler through local Express
  requests, including assembly, response serialization and client JSON parsing.
  Validation/auth, inventory cache and provider I/O are fixtures. Budgets are
  disabled so both versions can complete the same amount of matching.
- Paged fixtures simulate 10 ms of provider latency per call. Windows timer
  granularity means the measured delay can exceed 10 ms. Calls are counted
  independently of latency.
- Fetch results run the actual fetcher with simulated 10 ms provider calls,
  identity filter/deduplication and no precomputation. They do not time actual
  provider parsing or the rest of the playback pipeline.
- Existing user development processes were left running. Samples show
  substantial variation; these medians are observations, not confidence
  intervals or production SLAs. The JSON contains every measured sample.
- This is not a concurrent-user load test. It does not measure live addon
  latency/rate limits, memory growth, frontend rendering or hosted deployments.
- Score equality is deliberately not asserted: the changes fix false matches.
  Assertions instead check completed requests, channel counts, no scan
  truncation and the expected number of returned playback entries.

### Matching kernel, including preparation

| Distribution     | Channels × streams |      Before |       After | Time change |
| ---------------- | -----------------: | ----------: | ----------: | ----------: |
| Distinct numbers |          128 × 200 |     98.8 ms |     29.9 ms |      -69.8% |
| Distinct numbers |          512 × 800 |  2,475.7 ms |    462.3 ms |      -81.3% |
| Distinct numbers |      1,287 × 2,000 | 15,751.7 ms |  3,390.2 ms |      -78.5% |
| No numbers       |          128 × 200 |    101.5 ms |    116.8 ms |      +15.0% |
| No numbers       |          512 × 800 |  1,917.8 ms |  1,564.0 ms |      -18.4% |
| No numbers       |      1,287 × 2,000 |  9,797.2 ms | 11,429.8 ms |      +16.7% |
| Same number      |          128 × 200 |     95.6 ms |     97.1 ms |       +1.6% |
| Same number      |          512 × 800 |  1,615.3 ms |  2,137.8 ms |      +32.3% |
| Same number      |      1,287 × 2,000 | 11,396.3 ms | 10,426.8 ms |       -8.5% |

Distinct numbers allow early rejection before Dice comparison, giving a large
and consistent gain on those fixtures. That gain cannot be generalized to
unnumbered catalogs. The other distributions remain quadratic and had mixed
results, including slower medians. At the largest unnumbered size, sample
ranges were 8.85–11.16 s before and 9.94–13.91 s after.

### Local HTTP handler

| Scenario                                          |     Before |      After | Time change | Provider calls, before → after |
| ------------------------------------------------- | ---------: | ---------: | ----------: | -----------------------------: |
| 1,287 channels, pages of 25                       |   954.4 ms | 1,012.6 ms |       +6.1% |                        54 → 58 |
| 1,287 channels, pages of 100                      |   328.6 ms |   362.8 ms |      +10.4% |                        15 → 17 |
| Provider rounds skip to pages of 100              |   334.9 ms |   346.5 ms |       +3.5% |                        15 → 16 |
| 128 channels, 200 streams, 1,800 one-off events   | 1,773.2 ms |   189.2 ms |      -89.3% |                         25 → 7 |
| 512 channels × 800 numbered streams, auto-match   | 3,078.8 ms | 1,395.3 ms |      -54.7% |                        16 → 17 |
| 512 channels × 800 unnumbered streams, auto-match | 2,042.0 ms | 2,660.6 ms |      +30.3% |                        16 → 17 |

These are cold inventory scans. The two pagination-only scenarios retain a
small extra request cost in exchange for overlap protection. Requests to the
empty stream source are included in the counts. The unnumbered HTTP scenario
also regressed in this run; its sample ranges overlap substantially
(1.96–3.60 s before, 2.17–3.84 s after), so the exact percentage is not stable.
Sources contributing both catalog and stream resources bind their own channel
IDs and skip the expensive stream-only matching pass.

### Pagination regression found and fixed

The initial three-repeat probe found that rounded offsets retried overlap on
every page: 28 provider calls compared with 15 before the fork changes. The
scanner now disables overlap for that catalog after detecting the first
rounded-page repeat, and avoids overlapping a shorter final page. In the final
fixture this required 16 calls. Ordinary overlap still works, and all 1,287
channels are returned. A regression test asserts only one extra rounded-page
retry across the complete scan.

### Playback fetch

| Configured IDs from one addon |   Before |    After | Calls before → after | Returned entries before → after |
| ----------------------------- | -------: | -------: | -------------------: | ------------------------------: |
| 1                             | 15.43 ms | 15.60 ms |                1 → 1 |                           1 → 1 |
| 3                             | 15.40 ms | 15.65 ms |                1 → 3 |                           1 → 3 |
| 20                            | 15.47 ms | 15.67 ms |               1 → 20 |                          1 → 20 |

The extra requests run concurrently, so this fixture shows little elapsed-time
change. The old code silently skipped all but one ID; its smaller request count
was incorrect behavior. The corrected fetcher does increase provider load:
20 configured IDs produced 20 simultaneous requests. Provider throttling or
connection limits can make real latency worse than this fixture.

### Reproduce

```powershell
pnpm exec tsx scripts/benchmark-fork-improvements.ts
```

The default baseline is the commit above. Override `BENCH_BASE_REF`,
`BENCH_REPEATS` (minimum three), `BENCH_SIZES` (for example `512x800`) or
`BENCH_OUTPUT` when needed. The default output is the ignored local file
`testing/fork-performance.json`; `testing/fork-performance-smoke.json` records
the initial three-repeat probe before the pagination refinement.

Conclusion: the fixes have measurable benefits and costs. They cannot be
described as universally faster or regression-free. Unnumbered matching and
actual provider concurrency remain the areas to monitor or optimize next.
