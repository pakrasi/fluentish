> **Historical spec, not maintained.** Written 2026-10-04 in round 2 of the Fluentish build (designed in round 2, built in round 3) as the design spec for Explore's 3D view (the Type city).
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/DESIGN.md` (Explore › 3D), `src/domain/palace.js`, `src/features/explore/palace/`.
> What was actually built, and what changed: `docs/history/round3-learning-loop-and-languages.md`.

# Palace: design report

Round 2, 2026-10-04. A 3D view of the Explore map: the learner's German memory palace, where every word he has met has a place he can walk to, and the place shows how well he knows it.

The prototypes were built in the build scratchpad and are not in the repo. They use the real public content and the **shipped Atlas layout** (`content/atlas/de.json`, decoded with the app's own `src/domain/atlas.js`): 4,251 words, 1,450 phrases and 67 grammar concepts, 5,768 items in 31 groups. Knowledge is **synthetic** (a seeded hash of each item id, weighted by level and frequency, with an FSRS-like stability in days). No learner data was used in the prototypes. The repo was not edited.

## 1. Recommendation

**Build the Type city.** The Atlas floor plan, raised: every word is a building whose footprint is the word itself (its exact width, on its own line of its own paragraph), so the flat view is the Atlas, letter for letter. Tilting up adds one dimension, and it carries one fact: **how long he will remember the word**. A known word stands three to eight floors tall (one floor per doubling of its FSRS stability), a shaky word has one or two floors, a word not known is an open scaffold (the brand mark's open tile, in 3D), and a word not seen is type printed on the empty plot. Districts are the Atlas discs as plinths, with the knowledge ring wrapped around their rim.

Why this one:
- **Same layout, so the palace never rearranges.** x and z come from `content/atlas/de.json` and never change. Learning changes height, ink and nothing else. The Map/3D switch is a camera move plus a rise, not a re-layout, so everything he has learned about where things are carries over in both directions.
- **It stays a reading surface.** The type sits on the roofs in the map font (Newsreader, no kerning) at the Atlas positions, so at reading distance it is legible German (28 to 34 px when you fly to a word, 16 to 20 px across a district). The one 3D problem, taller buildings hiding the street behind them, is solved by the *street opening*: the buildings between the eye and the word in focus sink while it is selected or being learned.
- **Height means something he can act on.** "Food is a low quarter; my B1 rows are scaffolding" is a study decision. The plan view keeps the Atlas encodings exactly (ink, grey, open box, pale italic, cobalt), so state never depends on height alone.
- **The "word just learned" moment has a physical story.** The scaffold turns cobalt, the building rises out of it on the pop spring, the letters lift off the old roof and settle on the new one, a ring runs out across the plinth and the neighbours bob. It is 1.3 seconds, it plays only when a word changes state, and it reads at a glance from across a district.
- **It is cheap.** Five instanced draws (plinths, blocks, shadows, glyphs, labels) plus three small effect draws. 60 fps on WebKit at 390 px and on Chromium with the CPU throttled ×4; GPU time 1.2 to 3.2 ms per frame on the measuring Mac.

The **Relief** (concept C, also prototyped) is the runner-up. Its reading surface is excellent (no occlusion, type draped on gentle slopes) and its "letters lift and settle" moment was good enough that the City now uses it. But its height is a smoothed field, not a per-word fact, so it is decoration you cannot read; the City's floors are data.

## 2. Why the first sketch fell flat

Looking at the round-2 Palace sketch and its screenshots:
1. **It threw away the Atlas.** Words were re-scattered as dots inside cylinders, so the 2D map and the 3D view shared only group centres. Nothing he had learned about where words are survived the tilt.
2. **No material, no light, no ground.** One-pixel wireframes on paper read as a CAD diagram: no faces, no shading, no shadow, no horizon, so there was no sense of place.
3. **Every building was the same.** Floors were levels (A1 to C2), so every tower had six identical rings; knowledge was only the colour of 1 px dots. Nothing in the form changed when he learned.
4. **Labels floated.** 2D plates collided over the scene and were not part of the world.
5. **Nothing happened.** No moment for learning, no reason to come back.

Each point maps to a decision in the City: the Atlas is the floor plan; white-model shading with soft contact shadows and fog; height is stability; labels are in-world, constant-size and collision-culled; learning is a choreographed moment.

## 3. Concepts explored

| | A. Type city (prototyped, recommended) | B. Reading rooms (paper) | C. Relief (prototyped) | D. Night sky (paper) |
|---|---|---|---|---|
| Idea | The Atlas raised: each word a building on its own line; floors = stability; plinths = districts | A memory-palace interior: each group a round room; the paragraph lines wrap the walls as courses of text; walk from room to room | The Atlas laid on land whose height is the local share known; contour lines; words draped on the surface | Words as stars on a dome over you; constellations are word families; brightness is knowledge |
| Same layout as the Atlas | Yes, exactly (plan view = Atlas) | No: a disc's lines must be rewrapped onto a wall | Yes, exactly | No: a sphere projection of the disc map distorts and splits groups |
| What the 3rd dimension means | Per word: how long he will remember it | Nothing new (walls are a container) | Smoothed, per area: how much he knows there | Nothing new (depth is distance on a dome) |
| Legibility at 390 px | Good at reading distance; occlusion handled by the street opening | Good inside one room; you see one room at a time | Very good: no occlusion | Poor: labels on a dome, most stars tiny |
| Overview | Skyline per district; tall = known, scaffolds = gaps | None (you are inside) | Topographic islands; hills = known | Beautiful, not readable |
| Learned moment | Scaffold rises into floors; letters settle on the roof | A line of the wall lights | Letters lift and settle; the ground swells in a ripple | A star brightens |
| Gesture cost on a phone | Orbit, pan, pinch, as Maps | Walking (joystick or tap-to-go) is slow on a phone | Same as A | Look-around only |
| Verdict | **Build** | Rejected: breaks the shared layout and makes him walk | Runner-up; its moment moved into A | Rejected: decoration |

## 4. Encodings (Type city)

Ink is the scale, shape is the second channel, and height is a third channel that only ever adds to the other two. Colours come from the app tokens (`--x-*`); dark mode uses the dark tokens. No green, no role colours, the accent only for "you, today".

| State (`knowledge.js`) | Plan view (= Atlas) | 3D | Far zoom |
|---|---|---|---|
| Known: R ≥ 0.90, no lapse in 7 days | Ink type on the roof | Building of 3 to 8 floors, `floors = round(log2(S + 1))` with S the FSRS stability in days; a hairline per floor | Ink bar on the roof (plan); the massing (3D) |
| Shaky | `x-shaky` type | 1 to 2 floors | Grey bar / low massing |
| Not known | `x-unknown` type in the open box | An open scaffold one floor high: edges only, `x-box`. Seen from above, its top edges are the Atlas box | Outlined bar; scaffolds quiet to 30 % far away |
| Not seen | Pale italic `x-new` | No building: the type is printed on the plinth, the plot stays empty | Faint bar (plan), empty plot (3D) |
| Today (practised today, Good or Easy) | Accent type, hairline under it | The same, plus a cobalt band at the top of the walls | Accent bar, visible as cobalt flecks across the skyline |
| Selected | Accent type, 2 px underline | Cobalt roof outline; the street in front opens | |
| Just learned | Accent plate fading 1.3 s | See section 6 | |

- **District (group)**: a plinth the size of the Atlas disc. The group ring (known, shaky, not known, not seen from 12 o'clock, 2.5 px gaps, butt ends) is drawn on the rim, about 3 px at any zoom, and repeated around the plinth's side so it reads when tilted.
- **Labels**: group name in the map font, count under it ("95 of 208 known"), on a soft canvas pill, constant screen size, bigger groups win collisions, nothing drawn half off-screen. Hidden inside the group you are looking at, where the "where you are" pill takes over (as in the Atlas).
- **Level** is not height. It is already in the layout: each paragraph runs A1 to C2 from its first line down, so the north rows of every district are the easy words. A row that is still scaffolding is a level gap, visible from across the map.
- **Vertical exaggeration**: from 1,200 world units away the heights scale up smoothly to 5× (a cartographic convention), so the skyline reads from the overview. The card always states the true floors.
- **Contrast**: every text state is the Atlas state (all at least 3:1 on the roof colour, which equals the plinth colour). Wall shading is decoration; nothing is encoded in it.

Relief (for reference): land height = frequency-weighted share known within ~50 units, contour lines every 5 units with every fifth line stronger, interval doubling with distance so they stay a few px apart; words draped on the land in the Atlas encodings; the ring drawn on the land.

## 5. Level of detail and performance

### Levels
| Level | When (type size on screen) | Drawn |
|---|---|---|
| Districts | Overview | Plinths, ring, labels, massing with exaggeration up to 5×. Roof bars fade out in 3D (they stay in the plan) |
| Buildings | Type under 5 px | Blocks with floors; glyph quads collapse in the vertex shader, so they cost no fragments |
| Floors | Floor height over ~3 px | Floor hairlines appear by `fwidth`, never alias |
| Words | Type 5 to 8.5 px: bars crossfade to type; over 8.5 px: type only | SDF glyphs, crisp at any angle |

### How
- **One draw per layer, everything instanced**: 31 plinths, 5,768 blocks, 5,768 shadow quads, 68,774 glyph quads, 31 label plates and ~1,200 label glyphs; motes (720 points), rings (12) and study tiles (12) as pools. About 9 draws per frame.
- **GPU-side LOD and culling**: each glyph computes its on-screen size in the vertex shader and moves off-screen when under 5 px. No CPU loop per frame. At these counts a frustum test buys nothing; if the map passes ~20k glyphs, split draws per district and test 31 bounding cylinders on the CPU.
- **One item-state texture** (RGBA32F, 4 texels per item: state from/to and time, floors from/to and time, rise delay, group and centre). Every layer reads it, so a learned word is one 64-byte write; all animation (rise, colour, letters, bob, glow) is evaluated on the GPU from a single time uniform. CPU per frame: under 1 ms p95 even throttled ×4.
- **SDF text atlas** of the vendored map font (Felzenszwalb EDT, the TinySDF method): 150 glyphs (regular and italic) in one 1024 × 512 R8 texture, built at load in 33 ms (139 ms throttled ×4). For the build, ship it prebuilt as a PNG plus JSON (~60 kB) next to `metrics.json`. Glyph advances come from `metrics.json`, so type sits exactly where the Atlas puts it.
- **Render on demand**: the loop runs only while something moves (camera, tween, moment, label fade). At rest, zero frames.
- **Picking**: on tap, project each visible item's roof centre (5,768 points, under 1 ms) and take the nearest within its own box plus 6 px. Items whose type is under 7 px are not tappable; a tap there opens the district.
- **Adaptive resolution (build, not prototyped)**: DPR capped at 2. If the frame interval p90 exceeds 18 ms over 30 frames in motion, step to 1.5 then 1.25; draw one full-resolution frame when motion stops.
- **iOS budget**: Safari caps requestAnimationFrame at 60 Hz by default, so ProMotion phones still get a 16.7 ms budget.

### Measured
Scripted paths (`build/bench.js`): tilt plan → 3D, orbit the whole map, fly overview → word, pan along a district at reading distance, a study round's 7 learned moments. Frame interval from rAF; GPU time from `EXT_disjoint_timer_query_webgl2` where available.

| Run | Tilt | Orbit | Fly to word | Pan, type on screen | 7 learned moments | Worst |
|---|---|---|---|---|---|---|
| City, WebKit, iPhone 14 viewport 390 × 664, dpr 3 (rendered at 2) | 60 fps | 60 | 60 | 60 | 60 | p95 18 ms (WebKit timer is 1 ms coarse), CPU ≤ 1 ms |
| City, Chromium, iPhone 14 emulation, CPU ×4 | 60 | 60 | 60 | 60 | 60 | p95 16.8 ms, CPU p95 1.3 ms, GPU p95 1.3 to 3.2 ms |
| City, Chromium 390 × 664 dpr 1, CPU ×4 | 60 | 60 | 60 | 60 | 60 | p95 16.7 ms |
| Relief, WebKit 390 | 60 | 60 | 60 | 60 | 60 | p95 19 ms |
| Relief, Chromium iPhone 14, CPU ×4 | 60 | 60 | 60 | 60 | 60 (58 before the field rebuild was batched per round) | GPU p95 1.5 to 4.0 ms |

Cold load, Chromium ×4, cache off: City ready in 469 ms (scene build 294 ms, of which SDF atlas 139 ms); Relief 859 ms (the nearest-disc ring map, 512² × 31, belongs in the build step).

Caveats: both browsers ran on an M4 Mac (WebKit's GPU is the Mac's; Chromium uses ANGLE on Metal). An iPhone 14's A15 GPU is roughly 3 to 5 times slower, which puts the worst GPU frame at an estimated 5 to 15 ms: inside the budget but not by a wide margin, which is why adaptive resolution is in the build plan and a real-device test is a gate.

Memory: glyph instances 68,774 × 96 B = 6.6 MB of vertex data in the prototype. Packing to uint16 (positions in tenths, UVs normalized) brings it to ~2.2 MB.

## 6. Interaction and choreography

### Gestures
- **Phone**: one finger pans by grabbing the ground (the point under your finger stays under it), with inertia; two fingers pinch to zoom around the fingers and twist to turn; two fingers moving up or down together tilt (as in Apple Maps). Tap a word for its card, tap a plinth for its district. Double tap zooms ×2.2.
- **Desktop**: drag pans, right drag or shift-drag orbits, wheel or trackpad pinch zooms around the pointer, horizontal scroll turns.
- **Keyboard**: arrows pan, + and − zoom, Q/E or [ ] turn, Page Up/Down tilt, Escape closes the sheet. A "Districts" button lists all 31 groups as buttons that fly there.

### Moments (DESIGN.md tokens; springs are the kit's)
| Moment | Motion | Timing | Reduced motion |
|---|---|---|---|
| Map → 3D | Pitch 90° → 42°, yaw 0 → −24°, distance ×0.92 (cubic in-out). Buildings rise district by district from the middle out, then row by row (delay 0.55 × distance from the centre + 0.25 × row), each on a back-out ease with 8 % overshoot; shadows fade in with the rise | 1.7 s | 140 ms crossfade, then the 3D view at once |
| 3D → Map | The reverse; buildings settle into the plinths, bars return on the roofs | 1.7 s | Crossfade |
| Fly to a word | Log-distance zoom, cubic in-out, with a rise of 0.55 × the hop on long flights so you see where you are going; ends at 56° pitch with the type ~30 px, clear of the sheet (above it on a phone, left of the card on a desktop) | 0.55 to 1.5 s by distance | Jump |
| Street opens | Buildings between the eye and the selected word sink to 12 % (a corridor 60 to 110 units wide, up to 340 units deep) | 0.45 s in, 0.35 s out | Instant |
| District entry | Fly to frame the plinth (oblique 45°); other districts fade toward the canvas to 38 % and their labels hide; the 10 "Study next" words get the open tile hovering over them, dropping in on spring-pop 60 ms apart | 0.6 to 1.1 s; tiles from 0.55 s | Jump, tiles shown at once |
| Back from a study round | The camera frames the round's words; each word that became known plays the learned moment, 340 ms apart; toast "7 of 10 now known" | ~3.5 s for 7 words | Final state at once |
| A word learned | t = 0: scaffold edges turn cobalt. 0.05 s: a cobalt ring runs out across the plinth (1.0 s, ease-out). 0.08 s: the building rises from its old floors to its new ones on spring-pop (k380 c18, ~0.63 s, 19 % overshoot) with a cobalt line riding up the walls and the accent glow fading over 1.3 s. From 0.05 s, 40 ms apart: each letter lifts off (0.22 s) and settles on the new roof on spring-soft, now in cobalt. 0.08 s: ~70 fine ink and cobalt motes rise from the base and fall (0.9 to 1.8 s). Neighbours within 260 units bob once, the wave travelling at 260 units/s. The street opens for 2.4 s if he is not in a round | 1.3 s, motes to 1.8 s | Final state: cobalt type, new height, no glow, no motes |

Nothing moves at rest: no idle orbit, no drift, no looping glow.

## 7. Library choice and cost

All measured on 2026-10-04 with `npm pack` and esbuild (one-off, in the scratchpad; nothing installed in the repo).

| Option | Licence | Raw | gzip | brotli | Notes |
|---|---|---|---|---|---|
| three r186 official ESM (`three.module.js` + `three.core.js`) | MIT | 2,121 kB | 417 kB | 313 kB | **Works bundler-free**: `three.module.js` imports `./three.core.js` by relative path, so the two files vendored side by side load under `script-src 'self'` with no import map. The prototypes run on exactly these files with the app's CSP: zero violations in Chromium and WebKit |
| three r186, minified subset of what the prototypes use (one esbuild run, vendored) | MIT | 539 kB | 135 kB | 112 kB | Tested: both prototypes run unchanged on it. Tree-shaking saves little because `WebGLRenderer` pulls in most of the library |
| three r186, full, minified | MIT | 742 kB | 189 kB | 155 kB | |
| OGL 1.0.11 subset (renderer, program, geometry, texture, camera, maths) | Unlicense | 66 kB | 19 kB | 16 kB | Plain ESM sources with relative imports; bundler-free |
| Hand-written WebGL2 layer (estimate from the prototypes) | ours | ~25 kB | ~8 kB | | Programs, instanced attributes, textures, one camera |

For comparison, the whole app today is ~1.46 MB raw / 436 kB gzip of unminified JS.

**Recommendation: write the thin WebGL2 layer, do not vendor three.** Every pixel in the prototypes comes from our own shaders; three supplies only state management, attribute upload and a camera, which is ~500 lines. That keeps DESIGN.md's "Don't add 3D libraries" true, avoids a 135 kB lazy chunk for nine draws, and matches how the Atlas and the first Palace were built. The prototype code ports mechanically (ShaderMaterial → program, InstancedBufferGeometry → VAO, DataTexture → texImage2D; the GLSL is already WebGL2). If the owner later wants lit models or loaders, the minified three subset (135 kB gzip, MIT, lazy `import()` when 3D opens, cached by the service worker under `v/<sha>/`) is the measured fallback and needs no CSP change. OGL is the middle ground if we want a maintained layer at 19 kB.

Prototype sizes (unminified, gzip): `palace-core.js` 18 kB, `city.js` 7.5 kB, `relief.js` 7 kB, `palace.css` 1 kB. In the app the data costs nothing extra: the Atlas file (133 kB gzip) and the knowledge scores are already loaded by Explore.

Lazy loading: the 3D module and its shaders load only when the 3D segment is tapped; the first tap shows the plan view at once (it is the Atlas), and the rise starts when the module is ready (~300 ms on a throttled CPU).

## 8. Reduced motion and accessibility

- **Reduced motion** (system setting or the app's `data-motion="reduce"`): opening 3D is a 140 ms crossfade to a designed still at 42° pitch; flights jump; no inertia; no rise, no motes, no rings, no letters, no bob, no glow; learned words appear in their final state (cobalt type, new height). The still view is a complete picture: the skyline, the rings and the labels (checked on the City overview, the City after a round and the Relief overview).
- **The List view** (already shipped) remains the full text alternative; the canvas has `role="img"` with a label that points to it.
- **Districts list**: a DOM list of all groups with "95 of 208 known", each a 44 px button that flies there and opens the district sheet. This is the keyboard and VoiceOver route around the 3D view.
- **Sheets** are the existing Explore sheets (word card, district sheet with "Study next" in the map encodings and state in words), so screen readers get the same content as in the Atlas. German carries `lang="de"`.
- **Keyboard**: all controls are buttons with visible focus; the canvas takes arrows, + and −, Q/E, Page Up/Down and Escape.
- **Colour**: state is never colour-only (type style, box, italic, height, and words in the sheet). Under `forced-colors: active`, open the Atlas instead of 3D.
- **Transparency**: the "where you are" pill and the HUD go solid under `prefers-reduced-transparency`, as in the Atlas.
- **Failure**: a lost WebGL context, or no WebGL2, falls back to the Atlas with a one-line note.

## 9. Phased build plan

| Phase | Scope | Gate |
|---|---|---|
| 0. Decisions | Answers to section 10; DESIGN.md amendment (Explore › 3D: one WebGL context while open, the motes question, the learned moment) | Owner signs off |
| 1. GL layer and static city | `src/features/explore/palace/` lazy module: WebGL2 layer, item-state texture fed from `scores()`, plinths, blocks, shadows, SDF glyphs (prebuilt atlas in `src/vendor/newsreader-map/`), labels, LOD, render on demand, picking; the "3D" segment next to Map and List; reduced motion still; dark mode | 390 px WebKit and 1440 px screenshots light, dark, reduced; `npm test` with pure tests for floors, LOD thresholds and the item-state packing; no CSP violations |
| 2. Movement | Gestures, inertia, keyboard, fly-to, the street opening, Districts list, district sheet with study tiles, Study handing ids to Practice through the feature contract | 60 fps scripted bench on WebKit 390 and Chromium ×4; a real iPhone (14 or older) at 60 fps; VoiceOver pass |
| 3. The moment | Learned moment driven by real data: on opening 3D, items that became known since the last view (stored like the Atlas's `shown` list) play in sequence with the camera framing them; the return-from-round path | Reduced-motion check; the moment never replays for the same item and day |
| 4. Hardening | Adaptive resolution, packed instance buffers, context-loss fallback, prebuilt ring data, memory release on leaving 3D | 10 open/close cycles return GPU memory to baseline; cold open under 500 ms on a throttled CPU |
| 5. Modes | Level and Word type in 3D (buildings fly to their new plots on a GPU from/to arc; heights unchanged), Source | Mode switch at 60 fps |

## 10. Open questions for the owner

1. **Height = how long you will remember it** (floors from FSRS stability), not CEFR level. Level stays as the row order inside each district. Is that the right fact to build with?
2. **Motes.** DESIGN.md says no particle bursts and that the ripple is the celebration. The learned moment has ~70 fine motes for under 2 s on top of the rise, the letters and the ring. Keep them, or drop them and keep the rest?
3. **When does the moment play?** On return from a round (prototyped), or the next time he opens 3D, for everything learned since the last visit (closer to the Atlas rule, and it makes the palace a place to come back to)? Or both?
4. **Exaggeration**: heights scale up to 5× at the overview so the skyline reads. Fine as a map convention, or should height always be true?
5. **The street opening** sinks the buildings in front of the selected word. Does that feel right, or would he rather see them turn translucent?
6. **Where it lives**: a third segment (Map, 3D, List) inside Explore as prototyped, or its own entry ("Palace") on Look up?
7. **Dark mode as a night city**: today it is graphite massing with light type. Should known words' roofs glow faintly at night (the "windows that light up" idea), or stay quiet?
8. **Library**: hand-written WebGL2 layer (recommended) or the 135 kB three subset, which would make later experiments (lit models, hand-made objects) easier?
9. **Device**: which iPhone should the real-device gate use? The oldest one the owner still uses is the right one.

## 11. Files

The prototypes lived in the build scratchpad and were not kept: an index page, `city.html` + `city.js` (concept A, Type city), `relief.html` + `relief.js` (concept C, Relief), a shared `palace-core.js` (data, springs, SDF glyph atlas, item-state texture, text and label layers, effects, camera rig, gestures, picking, sheets, a scripted demo and the bench), a generated `palace-data.js` (topic and level layouts, glosses, synthetic knowledge; built read-only from the repo), copies of the app's stylesheets plus `palace.css`, an unmodified three r186 ESM build (prototype only), the vendored map font (OFL) with its `metrics.json`, the esbuild entries used for the size table, build and bench scripts, raw measurements, screen recordings and screenshots.

Prototype flags: `?plan` start flat, `?at` start in 3D, `?slow=4` slow motion, `?rm` reduced motion, `?dpr=1`. Console: `__palace.demo()`, `__palace.learn(i)`, `__palace.focusGroup(g)`, `__palace.bench(...)`.

## 12. Critique log (what the recordings showed, and what changed)

1. *Overview read as grey noise*: heights were under 1 % of the map's size. Added vertical exaggeration (up to 5×, smooth with distance) and faded roof bars in 3D, so the overview is a white model whose tall parts are what he knows.
2. *Label text sank into the busy texture*: SDF halo widened (radius 12) and a soft canvas pill added under each label; labels that would be cut by the screen edge are dropped.
3. *The learned word was hidden behind a taller building in front*: the street opening; the fly-to pitch raised to 56°.
4. *The glow plate was near black*: `color-mix()` tokens came back from `getComputedStyle` as `oklab()`, which the parser misread. Colours now go through a 1 px canvas, so any CSS colour resolves exactly.
5. *Neighbours' bob cut letters in half*: the bob is now computed at the building's centre for both the walls and the type.
6. *Today looked like Not known* (a cobalt roof outline reads as a box): today is now a hairline under the type, as in the Atlas; the outline is only for the selected word.
7. *The round's moments were too small to see from the district view*: the camera now frames the round's words before they play.
8. *Camera targets floated after exaggeration*: exaggeration is now a pure function of distance, so a flight's target height is computed for its destination.
9. *Dark mode showed white speckle* on scaffold-heavy rows: the scaffold edges were drawn opaque at the box colour; they now mix into the plinth and fade to 30 % far away.
10. *Relief: type was cut by the slope*: every glyph corner now samples the ground; the field changed from density (every district became one dome) to the local share known (A1 rows high, C1 rows low); a batched field rebuild per round removed the 58 fps dip.
11. *Still open*: on a phone, the round-return view is far enough that each moment is small; a short camera tour across the round's words is worth trying in phase 3. Phone overview framing clips the map's right edge on first open.

## 13. Skills used and skipped

- **threejs-animation**: render loop on demand, instancing for every layer, frame-rate-independent damping and inertia, DPR cap, disposal notes for the build. Its CDN import map was replaced by vendored files (CSP).
- **shader-glsl**: every material is a custom shader: SDF text with `fwidth` antialiasing, SDF rounded pills and tiles, screen-space-constant hairlines, contour lines with interval LOD.
- **particle-system**: the motes are a GPU point pool simulated in the vertex shader from a start time (ballistic with drag), recycled, seeded per burst.
- **add-mouse-driven-orbit**: used for its rules rather than its effect (record intent in handlers, damp in the frame loop, frame-rate-correct damping, coarse pointers keep the authored pose, reduced-motion still). Passive cursor orbit itself was not added: the palace is direct manipulation, and nothing moves at rest.
- **gsap-timeline / gsap-core / gsap-performance**: the choreography in section 6 is written as a timeline with positions (labels and offsets per moment). GSAP itself is not vendored: its licence is Webflow's "no charge" licence rather than OSI, the app's motion comes only from `core/motion.js`, and the per-word animation lives on the GPU, where a tween library cannot reach.
- **taste-skill**: design read: an editorial instrument for one expert user; dials VARIANCE 5, MOTION 6, DENSITY 7. One accent, plain labels, motion only for state change, everything reduced-motion safe.
- **dataviz**: height as an ordinal channel with discrete floors, every state also in type style and in words, the ring kept as the Atlas ring, a legend always on screen, the List view as the table.
- **playwright-cli**: WebKit iPhone 14 and Chromium sessions, CPU throttling through CDP, GPU timer queries, screenshots in light, dark and reduced motion, slow-motion strips and webm recordings.
- **design-md**: read; the DESIGN.md amendment is phase 0 work once the open questions are answered.
- **style-anchors**: skipped; the brand is set (Newsreader, Geist, graphite, cobalt) and a named style would fight it.
- **dither-background**: skipped; a near-black dither field would add texture where the brand asks for quiet surfaces.
- **pointer-trail-emitter, build-interactive-particle-trail**: skipped; a cursor trail is decoration with no information, and touch has no hover.
- **shader-dev**: skipped; no ray marching or volumetrics needed, and the cost would land on the phone GPU.

## Owner decisions (2026-10-05)
- Height = memory strength (stability), not CEFR level.
- Keep the ~70-mote sparkle in the learned moment, ONLY here; record it in DESIGN.md as the single allowed burst.
- Occlusion: buildings in front SINK while a word is selected.
- Engine: hand-written WebGL2 layer (~8 kB), no three.js.
- Coordinator defaults for the rest: moment plays on return from a round AND on next 3D open if missed; 5x overview height exaggeration OK; 3D is a third segment in Explore (Map · 3D · List); dark mode known roofs glow faintly; real-device test target: the owner's iPhone (model to be confirmed in a cutover-style checklist).
