# Channel matching benchmark

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
