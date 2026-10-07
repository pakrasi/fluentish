> **Historical spec, not maintained.** Written 2026-10-04 in round 2 of the Fluentish build as the design spec for Explore, the 2D word map under Look up.
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/DESIGN.md` (Explore section), `docs/ARCHITECTURE.md` §2, `src/features/explore/`.
> What was actually built, and what changed: `docs/history/round2-practice-and-explore.md`.

# Explore: design report

Round 2, 2026-10-04. A map of every German word, phrase and grammar concept in Fluentish, showing what the learner knows and what he doesn't yet, with switchable groupings and a stable layout he can learn his way around.

The prototypes (`atlas.html` and `palace.html`) were built in the build scratchpad and are not in the repo. They use the real public content: 4,096 words, 1,450 chunks and 67 grammar concepts, 5,613 nodes in all. Knowledge is **synthetic**, from a seeded hash of each item id, weighted by level and frequency. No learner data was used in the prototypes.

## 1. Recommendation

**Build the Atlas: a typographic map in Canvas 2D.** Each group is a round paragraph of German words set in Newsreader, most frequent first. Groups are placed on a fixed spiral, and knowledge is shown by ink. Zooming is semantic: from far away, words are drawn as bars of their exact width, then as type when they become readable, then a tap opens a word card. Six grouping modes animate words from one map to the next.

**Add the Palace later, as a second view of the same floor plan.** Each group becomes a building, and each floor is a CEFR level (A1 at the bottom, C2 at the top). A "Plan / 3D" switch tilts the atlas up into the buildings. Use it for orientation and memory ("Food is on the left; I'm missing half of its B1 floor"); do the reading in the Atlas. It needs no library: the prototype is about 250 lines of WebGL.

Why this hybrid:
- **Legibility at 390 px.** The Atlas shows real German at 16 to 20 px with no overlap, because the words are set as text lines rather than scattered as labels. The 3D view can show only about 170 labels at once, and nearer buildings occlude them. In 3D, the encoding of a "not known" item shrinks to a 2 px ring.
- **Stability.** In both views a word's position comes only from content (its group, its frequency rank and, in 3D, its level), so learning never moves anything. Because the floor plan is shared, what he learns about where things are carries over between the views.
- **The owner's brief asked for a "3D mind palace".** The Palace gives that, and the prototype measured 60 fps. But a reading surface where you must orbit to see past a building is the gimmick risk he named. So 3D is the overview and the moment of place, and the Atlas is where he works.

## 2. Three directions compared

| | A. Constellation (force graph, 2.5D) | B. Palace (true 3D, WebGL) | C. Atlas (typographic map) |
|---|---|---|---|
| Idea | Nodes as dots with edges (family, opposite), force-directed clusters, labels on demand | Buildings per group, floors per level, orbit and fly | Groups as round paragraphs of real type; ink shows knowledge |
| Legibility at 390 px | Poor. Labels collide, so you see dots plus about 60 labels | Medium near, poor far. About 170 labels, with occlusion | Good. Every word is readable at word zoom, with bars at far zoom |
| 6,000 nodes | Canvas or WebGL is fine. Force simulation costs about 200 ms per settle | WebGL points at 60 fps. Labels need font-size quantizing (measured) | Canvas 2D at 1 to 3 ms per frame (measured) |
| Known / shaky / not known / not seen | Dot fill and size. Shape is hard to read on dots | Filled / grey / ring / faint dot. The ring vanishes at overview | Ink / grey / boxed / pale italic. A text encoding that survives as bars |
| Mode switching | Re-simulate, then the positions jump | Points arc to new buildings (prototyped) | Words fly to their new paragraphs, staggered by destination (prototyped) |
| Deterministic | Only with seeded, persisted positions. Edges change the layout as content grows | Yes (shares the Atlas floor plan) | Yes: spiral packing plus frequency order, computed at build time |
| Choosing what to study | Weak: you need to read labels | Good at group level (buildings with ring counts) | Good at both levels: ring per group, "Study next" sheet, "Gaps only" |
| Reduced motion | Static layout is fine | Camera jumps, tilt is a crossfade | Crossfade 140 ms, camera jumps |
| Verdict | Not built. Edges and hairballs add noise; families and opposites read better as text | Built, kept as a second view | Built, recommended |

Direction A was judged on paper. Its distinctive asset, the relationship edges, works better as text: opposites as "groß — klein" pairs on one line, families as their own paragraph, and links in the word card ("Opposite: klein", "Same family: Unfall, Zufall …"), which navigate the map.

## 3. What was built and measured

| File | What it is | Size (gzip) |
|---|---|---|
| `explore/atlas.html` | Direction C, high fidelity: 6 modes, pan / pinch / wheel / double tap / keyboard, word card, group sheet, search, list view, gaps filter, intro, reduced motion, dark mode | 11.5 kB |
| `explore/palace.html` | Direction B: hand-written WebGL points and floor rings, a 2D label layer, orbit / pinch / pan, tap a building to fly in, Plan ↔ 3D tilt, 6 modes | 10.5 kB |
| `explore/explore-core.js` | Shared: synthetic knowledge, cluster modes, disc layout, spiral packing, spatial index | 4.6 kB |
| `explore/explore.css` | Fluentish tokens plus the new `x-*` Explore tokens | 3.5 kB |
| `explore/build/prep.py` | Builds `explore-data.js` from the repo's `content/` (read-only), with heuristic families and a hand-made opposites list | |
| Screenshots | Screenshots, slow-motion frame strips and a demo recording (not kept) | |

Flags: `?mode=family`, `?k=1.1&at=Apfel` (zoom to a word), `?nointro`, `?slow=8` (slow motion for recording), `?fps=1`, plus `window.__bench()`.

**Frame rate** (scripted pans, zooms and mode switches; draw time is CPU time per frame):

| Prototype / browser | Pan far | Zoom far → words | Pan at word zoom | Mode switch | Worst draw p95 |
|---|---|---|---|---|---|
| Atlas, Chromium 1440×900 | 60 fps | 60 | 60 | 60 | 4.7 ms |
| Atlas, Chromium, CPU throttled ×4 | 60 | 47 | 60 | 52 to 60 | 22.5 ms (bars-to-text crossfade band) |
| Atlas, WebKit, iPhone 14 viewport 390 px | 60 | 60 | 60 | 60 | 4 ms |
| Palace, Chromium 1440×900 | 60 | 60 | 60 | 60 | 5.5 ms |
| Palace, WebKit 390 px | 60 | 60 | 59 | 60 | 7 ms |

Laying out all six modes takes 153 ms on the Mac. That is why the plan below precomputes layout at build time. Two problems turned up while measuring and were fixed. The Palace first ran at 15 fps in Chromium because every label had a different fractional font size, which defeats the glyph cache; rounding sizes to 2 px steps brought it to 3 ms. The Atlas zoom band (fonts from 6.5 to 9.5 px, with about 1,000 small text draws) is its only weak spot; see the performance plan. macOS WebKit does not reproduce iPhone GPU or ProMotion behaviour, so a real-device pass is still needed.

## 4. Critique log (what the screenshots showed, and what changed)

1. *Group labels sat above the rings and collided across neighbouring discs*. They now sit centred in their own disc on a canvas-coloured plate, wrap to two lines, and fade out as the words become readable. The "where you are" pill takes over at word zoom.
2. *Small topics had no name at overview*. The label threshold now depends on the label's length, and single-word labels (family heads) show down to a 12 px radius.
3. *Opposites dropped pairs.* "alt" belongs to both alt/neu and alt/jung, and one place per item meant one pair lost a word. Pairs are now de-duplicated; the second opposite belongs in the card as a link. Pairs also need more space between them than inside them: 26 vs 10 units, with a hairline joining each pair.
4. *The "where you are" line floated over a different disc* and read as that disc's label. It is now a pill with a surface background and the lift shadow.
5. *A tapped word could sit under the sheet.* The camera now pans so the word lands in the top 45% of the free area.
6. *"Not seen" grey failed contrast* (2.5:1 light). It is now `#84868d` (3.3:1), and italic shape separates it from shaky.
7. *The closed desktop sheet peeked out at the bottom right*. Fixed.
8. *Cluster sheet: two columns broke long phrases mid-line*. One column when any item is over 16 characters.
9. *Palace points were 1 px at overview*, because world units come from the text layout. Points are now 24 units (one word line), with a fade-in from 0.8 to 2 px.
10. *Still open in the Palace, and inherent to 3D:* labels from nearer buildings occlude the floor being read, and the ring for "not known" is too small at overview. That is why 3D is not the reading surface.
11. *Still open in the Atlas:* family heads come from a prefix-stripping heuristic, and some are wrong (Mittel, statt, zumal, Zeitung under Zeit before a block-list). This is the content agent's job (section 6). Two words still land in two families, so the content needs a "primary family" rule.

## 5. Encodings and legend

Ink is the scale and shape is the second channel, so nothing depends on hue. This follows DESIGN.md: known is quiet ink, never green, and the accent means "you, today".

| State | Definition in the app (see `readiness.itemState`, `fsrs.R`) | As text (near) | As a bar (far) | Light contrast | Dark contrast |
|---|---|---|---|---|---|
| Known | itemState solid/known, or FSRS R(today) ≥ 0.90 (same bar as the readiness field) | Ink, Newsreader 400 | Ink bar | 16.6:1 | 16.2:1 |
| Shaky | itemState shaky, or FSRS R 0.70 to 0.90, or a lapse in the last 7 days | `x-shaky` (= ink-3) | Grey bar | 5.8:1 | 7.1:1 |
| Not known | itemState unknown, or an FSRS card still in learning, or R < 0.70 | Ink-2 text in an open box (hairline 50% ink, 3 px radius) | Outlined bar | text 12.5:1, box 3.4:1 | 13.1:1, 3.6:1 |
| Not seen | no record in any store | Pale italic `x-new` | Faint bar (13% ink) | 3.3:1 | 3.3:1 |
| Today | practised today with a rating of 3 or more | Accent (cobalt) text | Accent bar | 6.6:1 | 7.7:1 |

- The open box for "not known" is the brand mark's open tile: a slot still to be filled. It is the one state that asks for action, so it is the one with an outline.
- Articles are set at 72% size in ink-3 before the noun (`die Zitrone`), because gender is part of knowing a noun. Every word has its article in Word type mode, which groups der, die and das nouns.
- **Group ring** (the readiness ring's grammar): one arc per state from 12 o'clock, in the order known, shaky, not known, not seen, with butt caps and a 2.5 px gap, in the colours above. The label reads "87 of 175". The sheet shows the same stack as a 4-segment bar plus the counts in words, so no value depends on colour alone.
- **Gaps only** dims known and shaky items to 16%, leaving the not-known boxes and the not-seen italics.
- **Group score** (sheet): frequency-weighted share known (`zipf` for words; prio weight for chunks), the same idea as `readiness.gaps()`. "Study next" lists the top 10 not-known items: not known first, then shaky, then not seen, each tier ordered by frequency.
- Dataviz checks: there is no categorical palette, so the validator does not apply. The ordinal ink steps are monotone, and every text state passes 3:1 against both the canvas and the surface. A legend is always visible on the map, and the list view is the table alternative. Role colours, green and the accent as a fill are not used.

## 6. Cluster modes and the data each needs

| Mode | Groups | Available today | What the cluster-tagging content agent must produce |
|---|---|---|---|
| Topic | 22 word themes; chunks by category (5); grammar | `words/de.json` `theme`; `chunks/en.json` `category` | A topic for each chunk (most belong to "Talking and writing" or a real topic); optionally split `core` (592 words) into smaller sets |
| Word family | Stem families ("fallen: Fall, Unfall, Zufall, gefallen, ausfallen …") | Nothing. The prototype uses a prefix-stripping heuristic: 124 families, 586 words, some wrong | A **morphological segmentation for every word**: `{pre: ['aus'], stem: 'fall', suf: [], sep: true}`, a curated `family` id and head lemma, and exactly one *primary* family per item (secondary families as `also`). Families must be real word formation: Zeitung is not in the Zeit family, Gefahr is not in the fahren family |
| Prefixes / suffixes (new) | be-, ver-, ent-, wider-, zer-, miss-; -heit/-keit, -ung, -schaft, -ig, -lich | Nothing | Derived from the same segmentation, with no extra tagging. Add a short usage note per prefix (be- makes a verb transitive; wider- means against) |
| Opposites | Pairs by part of speech | Nothing. The prototype has 93 pairs; 70 matched the word list and 67 survived de-duplication | `opposites: [[a, b], …]` using card ids; the 23 missing lemmas added to the word list or the pairs dropped; a `primary` flag where a word has several opposites (alt: neu, jung) |
| Level | A1 to C2 | `level` on words and chunks; concept level | None |
| Word type | der / die / das nouns, verbs, adjectives, adverbs, prepositions, conjunctions, phrases, grammar | `pos`, `art` | Prepositions with their case and a usage note (for example bei / nach / zu) |
| Source | Mock exams, speaking practice, practice rounds, look up | Not stored. Card records have `first` but no origin | **App work, not content:** add a `src` field to new card records at creation (`'exam' \| 'speech' \| 'practice' \| 'lookup' \| 'script'`). This adds a field without changing a shape. Old cards fall back on the id prefix (BP/BT/BR mean speech, BL means reading, W/BW with exam days mean exam) |

Proposed file: `content/explore/tags.de.json`, versioned and checked by `check:content`:
```json
{ "version": 1,
  "morph":     { "W:ausfallen.verb": { "pre": ["aus"], "stem": "fall", "suf": [], "sep": true, "family": "fall" } },
  "families":  { "fall": { "head": "fallen", "label": "fallen", "note": "" } },
  "opposites": [["W:groß.adj", "W:klein.adj"], ["W:alt.adj", "W:neu.adj", { "primary": true }]],
  "chunkTopic":{ "K:ENG_CHUNK_0001": "communication" },
  "usage":     { "W:bei.prep": { "case": "dat", "note": "Location with people and places, with verbs of staying: bei Anna, beim Arzt." } } }
```
Rules for the agent: correct German only (the source notes contain learner spellings and some words tagged with the wrong part of speech, which must be fixed, not copied); no personal content; and every family must have at least 3 members present in the word list.

## 7. Interactions

- **Map.** One finger pans, with inertia (none under reduced motion). Pinch or trackpad zooms around the fingers; the mouse wheel zooms or scrolls. Double tap zooms ×2.2. The + and − buttons are 44 px. Arrow keys pan and the +/− keys zoom. Zoom runs from 0.6× fit to 4×.
- **Semantic zoom.** At overview, group names sit in the discs and words are bars. Between 6.5 and 9.5 px font size, bars crossfade into type. From 9 px up, the "where you are" pill names the group under the screen centre.
- **Tap a word** to open the word card: kind, level, group; the word with its article; plural; English; example and translation in Newsreader; state ("Shaky · Recall 72% · last practised 12 days ago"); links (Opposite, Same family) that fly to that word; and **Practise now / Add to today**.
- **Tap a group** (or tap at far zoom) to fly in and open the group sheet: name, score, a 4-segment stack with counts, **Study next** (10 items), and **Study 10 from this group**. Both buttons hand item ids to Practice through the feature contract (a custom round), so the schedule stays the single FSRS one. Explore never writes card state.
- **Find** (magnifier): matches German with umlauts and ß folded, prefix first, then English; picking a result flies to the word and opens its card. When the word is not in the current mode (for example Opposites), the map switches to Topic first.
- **Map / List** switch: the list view is a real DOM list of the same groups in the same order, with "87 of 175 known" and each item's state in words. It is the accessible alternative and the place for text search with the system find.
- **Palace** (phase 3): one finger orbits, two fingers pinch and pan; tap a building to fly in at a low angle; tap a word label for its card. Plan / 3D tilts between the floor plan and the buildings.

## 8. Motion choreography

Every motion here is a state change or a reveal, and nothing moves at rest.

| Moment | Motion | Timing | Reduced motion |
|---|---|---|---|
| First open of the day | Words fade in group by group, like the readiness field writing itself | about 1.1 s total, 420 ms per word, 28 ms group stagger | Final state drawn at once |
| Mode switch | Each word flies from its old place to its new one on spring-soft (k170 c20). Delay = destination group order × 200 ms + per-word jitter up to 90 ms, so groups assemble one after another. Words leaving the mode fade out in place (2.2× speed); words arriving fade in at their target. Rings and labels fade in after 55% of the move. The camera frames the new map on a 700 ms smooth zoom; if a word is selected and stays in the mode, the camera follows that word instead | about 900 ms worst case | 140 ms crossfade, camera jumps |
| Fly to a word or group | van Wijk & Nuij smooth zoom (zoom out a little on long hops so you see where you're going), cubic in-out | 380 to 1,100 ms by distance | Jump |
| Word or group sheet | Sheet rises on spring-snappy (380 ms) and exits on ease-in (160 ms). The selected word gets a 2 px accent underline | 380 / 160 ms | Opacity only, 140 ms |
| Back from a round (phase 2) | Items that became known land in accent with the existing `ripple()` across their line | 720 ms | Final colours |
| Plan → 3D (phase 3) | The camera pitch eases from 86° to 35°; the floor plan rises into floors. On mode switch, points travel on a small arc (+60 units at midpoint) | 900 to 1,400 ms | Crossfade between the two views |

The DESIGN.md stagger cap (28 ms, 8 items) is for lists. The map is a field, so the mode switch uses its own "flow" stagger, capped at 290 ms of total delay. This is written into the draft DESIGN section.

## 9. Performance plan

1. **Precompute layout at build time.** `tools/explore-layout.mjs` measures widths with Newsreader's advance-width table (from the self-hosted font file, not canvas `measureText`, so every device gets the same line breaks) and writes `content/explore/layout.de.json`: per mode, the group centre and radius, and for each item `[x, y]` as Int16. That's about 5,600 × 6 × 4 bytes, roughly 140 kB raw and an estimated 60 kB gzipped. Without this, layout takes about 150 ms on the Mac and probably 3 to 4 times that on a phone.
2. **One Canvas 2D, rAF only while something moves** (fling, flight, morph, intro), as the field canvas does. Device pixel ratio capped at 2.
3. **Cull by the view rectangle; draw in state batches** (one `font` and `fillStyle` per state per frame).
4. **Quantize text sizes** (0.5 px steps in the Atlas, 2 px in the Palace) so glyph caches hit. This was measured: 43 ms dropped to 3 ms per frame.
5. **For the bars-to-text band** (6.5 to 9.5 px): cache each group's paragraph as an offscreen bitmap at two zoom tiers, rebuilt when knowledge changes. This removes the about 1,000 small text draws that cost 22 ms on a throttled CPU.
6. **Spatial grid** for hit testing (96-unit cells), rebuilt per mode.
7. **The Palace adds one WebGL context, only while the 3D view is open.** It uses low power, points plus line rings, and a 2D label layer capped at 170 labels with grid collision; it is disposed on leaving. A lost context falls back to the Atlas. DESIGN.md allows one WebGL context per page (the atmosphere is on Today, not here), and the "Don't add 3D libraries" rule holds because nothing is vendored.
8. **Library audit** (checked 2026-10-04 with `npm view` and `npm pack`): three.js r186 is MIT, ships no minified build, and three.core.js is 1.46 MB raw / 286 kB gzipped and would need a bundler. regl 2.1.1 is MIT, 28.5 kB gzipped. d3-force 3.0.0 is ISC, 3 kB gzipped. ogl 1.0.11 is Unlicense. **None is needed.** Spiral packing replaces force simulation, and both renderers are hand-written (about 11 kB gzipped each), in keeping with the vendor-with-hash rule and the CSP.

## 10. Accessibility

- **The list view is a full alternative.** Every group and item, with its state in words, readable by VoiceOver and keyboard. The canvas has `role="img"` with a label pointing to it.
- Keyboard: all controls are buttons with visible focus. The map takes arrows and +/−, and Escape closes the sheet or search.
- Touch targets are 44 px: mode chips, zoom buttons, link chips and sheet buttons.
- State is never colour-only: there's the box, italics, and words in the sheet and list. Every text state is at least 3:1. Under forced colours the canvas should redraw with `CanvasText` for known, `GrayText` for shaky and not seen, a `CanvasText` box for not known, and `Highlight` for today (phase 1 task).
- Reduced motion: see the table in section 8. Inertia is off, flights jump, and morphs crossfade. Haptics are unaffected.
- `prefers-reduced-transparency`: the "where you are" pill and the HUD gradient become solid canvas.
- German text in the DOM carries `lang="de"` (card, list, search results) so VoiceOver reads it in German.

## 11. Stability: the palace must not move

- Position = f(content), never f(knowledge). Learning changes ink, not place.
- Within a group the order is a content-assigned `seq` (initially the frequency rank). New items get the next `seq`, so they append to the last lines of their paragraph.
- Each group's disc reserves 15% radius headroom. Group centres are packed once and stored in `layout.de.json`. If a group outgrows its headroom, repacking is an explicit content release that the app announces once ("Map updated: 40 new words in Food and drink"), with the move animated a single time.
- One place per item per mode. Secondary memberships (a second opposite, a second family) appear as links in the card, never as duplicates.
- Fonts are self-hosted (DESIGN.md already plans this), so the width table matches what is drawn.

## 12. Phasing

| Phase | Scope | Gate |
|---|---|---|
| 0. Content | `tags.de.json` (morphology, families, opposites, chunk topics, preposition usage); `explore-layout.mjs` and its tests (deterministic output, one place per item, no overlapping discs, bounds) | `check:content` passes; German reviewed |
| 1. Atlas | New `explore` feature: Topic, Level and Word type modes; real state from the FSRS and Igloo stores; word card; group sheet with Study next leading to a Practice round; search; list view; reduced motion; dark mode | 390 px WebKit screenshots; 60 fps on a real iPhone; list view with VoiceOver |
| 2. Relationships | Word family, Prefixes, Suffixes, Opposites and Source modes; card links; Gaps only; ripple on return from a round; B1 exam items and grammar items as nodes (about 6,700) | Source needs `src` on new cards |
| 3. Palace | 3D view of the same floor plan, Plan / 3D tilt, tap a building, tap a floor to land in the Atlas filtered to that level | Desktop first; on phone behind a switch until a device test |

## 13. Skills used

- **taste-skill.** Design read: app screen for a single expert user, an editorial instrument in the existing Fluentish language. Dials: VARIANCE 4, MOTION 5, DENSITY 7 (it's a data surface). Applied: one accent, one radius system (pill chips, 12 px controls, 20 px sheet), no decorative dots, plain labels ("Gaps only", "Study 10 from this group", "87 of 175 known"), motion justified per moment, nothing looping, reduced motion everywhere.
- **dataviz.** The form is a map, not a chart, with a legend always visible. Ordinal ink steps plus a shape channel, contrast computed for every state, text in text tokens, a table (list) view, and hover replaced by tap targets larger than the mark (6 px slop, a 96-unit grid).
- **design-md.** The draft Explore section follows the existing file's frontmatter and section style (`DESIGN-EXPLORE-SECTION.md`).
- **playwright-cli.** WebKit iPhone 14 and Chromium 1440 sessions, screenshots in light, dark and reduced motion, slow-motion frame strips, a `.webm` recording, and CDP CPU throttling for the benchmark.
- Not used: **archify** draws architecture and sequence diagrams; nothing here needed one. **hairline-create** makes a single isometric line figure on its own engine; its single-stroke isometric look was a reference for the Palace's floor rings, but its engine draws one figure, not 6,000 data points. **image-to-code** had no reference image to match. **site-review** belongs to the later review pass.

## 14. Questions for the owner

1. Should the article be shown for every noun on the map (current), or only in Word type mode? It adds about 25% width, and gender is part of knowing a noun.
2. Grammar: 67 concepts as nodes (current), or the 693 grammar items? Concepts keep the map readable; items match how they're scheduled.
3. Should "Source" also include **Script** (from script mode), so the vocabulary of a script (such as a talk the owner is preparing) shows as a group?
4. 3D on phone: opt-in switch, or desktop only?

## 15. Files

The working files (this report, a draft Explore section for `docs/DESIGN.md`, the prototypes, the generated data file, the prep script, screenshots, frame strips and a demo recording) lived in the build scratchpad. Only this report was kept; the draft section went into `docs/DESIGN.md`.

## Owner decisions (2026-10-04)
- Articles: ALWAYS show der/die/das on every noun in the map.
- 3D palace: Phase 2, on phone AND desktop, after a dedicated design pass to make it genuinely beautiful (current wireframe-cylinder sketch is not the bar).
- Grammar in the map: the 67 concepts (each scored from its items), not the 693 items.
- Script mode: give scripts their own Source group (coordinator default).
