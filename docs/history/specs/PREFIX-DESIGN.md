> **Historical spec, not maintained.** Written 2026-10-04 (designed in round 2, built in round 3) in round 2 of the Fluentish build as the design spec for Word building (German verb prefixes, roots, suffixes and word chains).
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/ARCHITECTURE.md` §3.3 (Word building), `src/domain/wordbuild*.js`, `src/features/build/`, `authoring/build/`.
> What was actually built, and what changed: `docs/history/round3-learning-loop-and-languages.md`.

# Word building: prefixes and suffixes

Design for a new Practice mode in Fluentish, written for the build agent. Round 2, 2026-10-05.

The owner wants to know German verb prefixes well enough that, given a root verb he knows, he can work out what a prefixed verb means (stellen → vorstellen, ausstellen, einstellen, abstellen, umstellen, bestellen, verstellen). He also wants to know when he can't work it out and has to learn the verb as a word. Then he wants to go on past the prefix to the suffix, the word type it makes and the article it decides. His sketch was a compass: the root in the centre, spatial prefixes as directions (vor ↑, aus ←, ein →, ab ↓) and the other prefixes as "overlays" that change the mechanism (um, be, ver).

The prototypes lived in a working folder that was not kept; they are not in this repo. They used real German, all of it in `data.js` and checked by hand. Knowledge states in the prototypes were a fixed demo, not the learner's data.

| File | What it is |
|---|---|
| `compass.html` | **Prototype 1 (high fidelity).** The prefix compass (learn a prefix, predict a verb, see how derivable it is), the "Which prefix?" drill for the prefix cards, and the root × prefix Table with two lenses. URL flags: `?root=legen&pre=zer`, `?view=drill`, `?view=table&col=aus&lens=know`, `?reveal=1&guess=T`. |
| `machine.html` | **Prototype 2 (high fidelity).** The sentence machine (one sentence in five frames: the separable prefix travels to the end, ge- and zu slot in, ge- is turned away by a welded prefix), "Your turn" (the sentence card) and "Split or stay" (the 60-second game). Flags: `?s=bestellen&f=perf`, `?m=turn&ti=2`, `?m=game`. |
| `chain.html` | **Prototype 3 (medium-high fidelity).** Suffix chains: grow a word piece by piece, guess the article, and see the line from the ending to the article. The article chart sits under the chain. Flags: `?c=verstehen`, `?all=1`, `?noguess=1`. |
| `data.js` | 21 prefixes, 15 roots, 170 prefixed verbs (72 literal, 80 picture, 18 word to learn), 9 sentence frames × up to 5 forms, 11 suffix rules, 5 chains. |
| `picto.js` | The pictogram engine: one side-view scene per prefix; the path is always drawn, and the object travels it once. |
| (screenshots) | 390 px WebKit and 1280 px Chromium screenshots, light and dark, reduced motion, and four screen recordings (compass, machine, chain, game). Not kept. |

---

## 1. Recommendation

Build one Practice mode, **Word building**, with four screens that follow the order he learns in:

1. **Prefixes** (the compass). Each prefix is its own item: its direction or mechanism, whether it splits, where the stress goes, and what ge- does. The "Which prefix?" drill is the prefix card: the motion plays and he taps the prefix on the compass.
2. **Verbs** (compass and Table). Root × prefix: he predicts the meaning from the parts, says whether he expects to work it out, then sees the meaning and how derivable it is: literal, picture or word to learn. The Table shows the whole grid and the pattern down each column.
3. **Sentences** (the machine). The mechanics in five frames, then "Your turn" cards where he types the verb pieces into the gaps.
4. **Suffixes** (chains). Prefix verb → noun, adjective and abstract noun, with the article each ending gives.

All of it is reviewed in one mixed round through the shared FSRS schedule, in a new deck. "Split or stay" fills the 60-second slot on Today.

Why this and not a single clever screen:
- **Each screen teaches one thing with its own motion.** On the compass, motion carries meaning (where the thing goes). In the machine, it carries syntax (where the piece goes in the sentence). In the chain, it carries morphology (which ending sets the article). In earlier sketches one screen did all three, and every animation became decoration for the other two.
- **Honesty is built into the data.** Every verb carries a grade and a "how" line that says whether its explanation is the literal meaning, a picture to remember it by, documented history, or nothing (a word to learn). The interface never presents a mnemonic as etymology.
- **Generation before recognition.** On every verb card he commits to a guess before the answer shows: the meaning in his head, plus how derivable he expects it to be. The reveal then grades that second guess, which trains the skill he asked for: guess well, and know when not to guess.

The B1 exam was a few days away when this was written. Section 11 recommends building none of this before the exam except, optionally, the 60-second game, which needs no new content.

---

## 2. Concepts explored

| | Concept | Verdict |
|---|---|---|
| A | **Prefix compass.** Root in the centre; prefixes as chips around it; tap → the root's object travels the prefix's path in a pictogram, the prefix flies onto the root word and joins it with a visible joint (separable) or a weld (inseparable). | **Built (P1).** It is the spatial model he drew, and the strongest place to learn each prefix as an item. |
| B | **Root × prefix table** (periodic-table style). Cells shaped by derivability (solid literal, hatched picture, ring with a dot for word to learn, small dot for no common verb); a second lens shows knowledge. Tap a column to see what a prefix does across 15 roots. | **Built inside P1** as the Table view. It does the pattern work (looking down a column) that the compass cannot. It is not a learning screen on its own. |
| C | **Sentence machine.** The same sentence in Präsens, Perfekt, weil/dass, with a modal and with zu. Tiles keep their identity: the particle physically travels, ge- and zu drop into the gap, and ge- bounces off a welded prefix. | **Built (P2).** It makes the mechanics felt, and it doubles as the reveal for the typed sentence cards. |
| D | **Word chain.** Grow a word: stellen → vorstellen → die Vorstellung / vorstellbar → die Vorstellbarkeit. The ending slides on, the word-type label rolls over, and the article lands with a dotted line from the ending. | **Built (P3)** after the owner added the suffix layer. |
| E | **Split or stay.** A 60-second binary game: does the prefix split off in a main clause? | **Built inside P2.** It is fast, works on the go, and trains the decision he makes every time he writes a Perfekt. |
| F | 3D "prefix space" (a WebGL frame with the root at the origin, prefixes as vectors on X/Y/Z). | **Rejected on paper.** It reads as a coordinate frame, but it costs an orbit to read a label, and it would add the app's second WebGL context. The compass keeps the side view in 2D, with the third axis shown as a pictogram. |
| G | Drag the prefix onto the root. | **Rejected for input.** Dragging is slow on a phone and hard with a keyboard or switch control. Tapping starts the same flight. |

---

## 3. The journey and screens

Route prefix: `#/practice/build` (feature folder `src/features/practice/build/`, following `clusters/`).

```
#/practice/build                       hub: four rows (Prefixes, Verbs, Sentences, Suffixes) + "Review · N due"
#/practice/build/prefixes[/<p>]        compass; ?root=<root>
#/practice/build/drill                 "Which prefix?" (PX cards) round
#/practice/build/table[?col=<p>|row=<root>]
#/practice/build/machine[/<frame>]     sentence machine
#/practice/build/suffixes[/<chain>]    chains + article chart
#/practice/round?kind=build:due | build:new:<stage> | build:pick&ids=…   rounds through round.js
#/practice/build/game                  Split or stay (Today's 60-second row)
```

### 3.1 Hub

```
┌──────────────────────────────────┐
│ < Practice                       │
│ Word building                    │  h1
│ ──────────────────────────────── │
│ Prefixes              N of 21 ▸  │  row: label, known of total, mini field strip
│ ▪▪▪▪▪▪▪▪▪▪▪□□□□□□□□□□            │
│ Verbs                 N of 170 ▸ │
│ Sentences             N of 41 ▸  │
│ Suffixes              N of 46 ▸  │
│ ──────────────────────────────── │
│ [ Review · N due, M new  ·  K min ]   dock button (one round, all card types)
└──────────────────────────────────┘
```
New items unlock in order: a prefix's verbs only after its PX card has had a first Good; suffix words only after their SX rule card. The hub's Review button is the normal way in; the four rows are for browsing and learning.

### 3.2 Prefixes: the compass (P1)

```
┌──────────────────────────────────┐
│ Prefixes                          │
│ [Compass][Which prefix?][Table]   │  segmented
│ Root verb                         │
│ (▪stellen)(▪legen)(▪nehmen)(▫set… │  chips, known roots first (W:<root>.verb)
│ ┌──────────────────────────────┐ │
│ │            [auf]             │ │  ring: 8 separable directions
│ │    [zu]            [vor]     │ │  each chip carries a 18×4 mark for this root:
│ │          ╭───────╮           │ │  solid / hatched / outline / faded (no verb)
│ │ [aus]   │ ▮ ⇢ ⊔ │    [ein]  │ │  pictogram: the root's object travels the path
│ │          │ein|stellen│        │ │  the word: joint or weld, stress dot
│ │   [nach]  ╰───────╯   [an]   │ │
│ │            [ab]              │ │
│ └──────────────────────────────┘ │
│ Paths: stressed splits, unstressed stays                  │
│ [um][über][unter][durch]         │  dual prefixes
│ Welded on: change how the verb works                      │
│ [be][ver][ent][er][zer][ge]      │  inseparable prefixes
│ ┌ ein-  (Splits off) ──────────┐ │  prefix card
│ │ in, into                     │ │
│ │ ▒ Stressed. Splits off: ich stelle … ein. ge- goes inside: eingestellt. │
│ │ setting, adjusting   einstellen                         │
│ │ into a group         einstellen, einbeziehen            │
│ │ Opposites: aus- (in / out)   │ │
│ └──────────────────────────────┘ │
│ ┌ einstellen? ─────────────────┐ │  verb card (PD)
│ │ ein- in, into + stellen put  │ │
│ │ Say what you think it means. Can you work it out?       │
│ │ (Yes) (Partly) (No)          │ │
│ │ [ Show meaning ]             │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```
After "Show meaning": the meaning, the derivability ladder (Literal | Picture | Word to learn; the accent pin slides from his guess to the truth), one line of feedback on the guess, the "how" line with its label, the example sentence with the split particle underlined, the English and the participle, then grade4 ("Did you know what it means?").

**Compass geometry.** It is a side view: you face right, up is up. The opposites sit across from each other: auf ↑ / ab ↓, ein → / aus ←, vor ↗ / nach ↙, and zu ↖ / an ↘, which both mean "toward something". This changes his sketch in one way, and the doc should say why when it shows him: his sketch put vor at the top. In German the vertical axis belongs to auf/ab (aufstellen = set up, abstellen = put down), so vor moves to the forward diagonal ("in front, ahead"). His ein/aus/ab placements stay as he drew them.

**The three rings are the prefix model** (Section 4): directions (separable), paths around the object (dual: stressed reading literal and separable, unstressed reading figurative and welded), and welded-on prefixes (inseparable, which change how the verb works and have no direction). His word "overlays" maps onto the third ring.

### 3.3 Which prefix? (PX cards)

The compass without marks or word; the pictogram plays a prefix's motion and he taps the prefix. Right: the chip pops and flies onto the root. Wrong: a 300 ms nudge, the right chip is outlined and the motion replays. Round segments and "3 of 8" as in every round. The reverse card ("ver-: what does it do, does it split?") is self-graded. See 6.1.

### 3.4 Table

A real `<table>`: 15 roots (rows, known first) × 19 prefixes in three groups (Splits | Both | Stays on). Lens: "How derivable" (shape) or "What I know" (Explore's ink encoding). Tap a prefix header → the other columns fade to 18 %, the column's cells pop in on a stagger, and a card below lists the column's verbs grouped literal → picture → word to learn, with counts ("aus- across 12 roots: 5 literal · 7 picture · 0 to learn as words"). Tap a root → its row. Tap a cell → it opens on the compass. On a phone the grid scrolls sideways with the root column sticky. That is acceptable for a reference view, and the prototype shows it works at 390 px.

### 3.5 Sentences: the machine (P2)

```
┌──────────────────────────────────┐
│ [Machine][Your turn][Split or stay]
│ (aufstehen)(anrufen)(vorschlagen)…│
│ (Present)(Perfekt)(weil / dass)   │
│ (Modal verb)(zu + infinitive)     │
│ ┌──────────────────────────────┐ │
│ │ Verb [auf|stehen]  get up    │ │  tray: the infinitive
│ │                              │ │
│ │ [Ich][bin][um sieben]        │ │
│ │       └Position 2┘           │ │
│ │ [auf|ge|standen].            │ │
│ │ └──────End──────┘            │ │
│ └──────────────────────────────┘ │
│ ▒ Perfekt: haben or sein in position 2, the participle at the end. ge- goes between prefix and stem.
│ ■ verb ■ haben, sein, modal ■ ge-, zu ● stressed syllable
│ Play from the infinitive          │
└──────────────────────────────────┘
```
Tiles are the existing grammar tiles: role-door for verb pieces, role-turn for the helper, role-slot for ge- and zu, plain for the rest. Pieces of one verb touch and never wrap apart. The two slots of the sentence bracket ("Position 2", "End") are labelled under the tiles. Frames: aufstehen, anrufen, vorschlagen, einladen, sich vorbereiten (two prefixes: vor- splits, be- blocks ge-), bestellen, verstehen, and the pair übersetzen (translate) / übersetzen (ferry across).

**Your turn** (PS cards): "Ich ___ dich heute ___." · anrufen (phone) · Perfekt → he types `habe angerufen`. Graded by the real grader. Then the machine plays the answer from the infinitive.

### 3.6 Suffixes: chains (P3)

```
┌──────────────────────────────────┐
│ Suffixes                          │
│ (stellen → vorstellen)(stehen → verstehen)…
│ [x] Guess the article first       │
│ ┌──────────────────────────────┐ │
│ │ stellen  Verb                │ │
│ │ │ put, place                 │ │
│ │ └ vorstellen  Verb           │ │
│ │   │ introduce; imagine       │ │
│ │   ├ die Vorstellung  Noun    │ │  dotted arc from -ung to die
│ │   │   -ung is always die.    │ │
│ │   └ vorstellbar  Adjective   │ │
│ │       └ (?) Vorstellbarkeit  │ │  [der][die][das]
│ │   (vorstellen + -ung)(… + -bar)  grow buttons after the branch
│ └──────────────────────────────┘ │
│ Endings that decide the article  │
│ ┌der──────┐┌die──────┐┌das─────┐ │
│ │-er      ││-ung     ││-nis    │ │
│ │bare stem││-heit    ││das +   │ │
│ │         ││-keit    ││infinit.│ │
│ │         ││-schaft  ││        │ │
│ └─────────┘└─────────┘└────────┘ │
│ Endings that make adjectives: -bar, -lich, -sam
└──────────────────────────────────┘
```
A chain is a **tree**, not a line. vorstellbar comes from vorstellen, not from die Vorstellung, so the owner's example chain is drawn as two branches: vorstellen → die Vorstellung, and vorstellen → vorstellbar → die Vorstellbarkeit (and unvorstellbar). The prototype makes this visible.

### 3.7 Today: Split or stay (60 s)

A verb in Newsreader 44 with its meaning under it; two big buttons, "Splits" (ich stelle … auf) and "Stays" (ich bestelle), with keys ← and →. Right, separable: the joint opens, the stem slides to the front and the prefix hops to the end: "fahren … um". Right, inseparable: the weld line draws under the word. Then the example sentence shows for 650 ms. Wrong: a 300 ms nudge and the example sentence for 1.5 s. A dual verb shows its meaning, so "umfahren: knock over" splits and "umfahren: drive around" stays. The end screen shows one figure ("N of M right in 60 seconds") and the missed verbs as sentences.

---

## 4. The prefix model

Checked against standard reference grammar (Duden Grammatik's treatment of particle verbs, Helbig/Buscha, the usual B1 textbook tables). Meanings are tendencies, so the senses below are the productive ones, and the "word to learn" column lists common verbs where the sense does not apply.

**Mechanics by kind**

| Kind | Stress | Main clause | Perfekt | zu-infinitive | Prefixes |
|---|---|---|---|---|---|
| Separable | on the prefix: AUFstehen | splits: Ich stehe um sieben auf. | ge- inside: aufgestanden | zu inside, one word: aufzustehen | ab, an, auf, aus, bei, ein, fest, her/hin, los, mit, nach, vor, weg, zu, zurück, zusammen … |
| Inseparable | on the stem: beSTELlen | never splits: Ich bestelle. | no ge-: bestellt | zu before, two words: zu bestellen | be, emp, ent, er, ge, miss, ver, zer |
| Dual | prefix stressed = separable reading; stem stressed = inseparable reading | by reading | by reading | by reading | durch, über, um, unter, wider (mostly inseparable), wieder (inseparable only in wiederholen = repeat) |
| Two prefixes | the outer one decides splitting; any inseparable one blocks ge- | Ich bereite mich vor. | vorbereitet (no ge-) | vorzubereiten | vorbereiten (vorbereitet), anerkennen (anerkannt), beibehalten (beibehalten), einbeziehen (einbezogen) |

The tendency for dual prefixes: the **stressed, separable reading is literal and spatial** (übersetzen = ferry across, umfahren = knock over, durchfahren = go through without stopping). The **unstressed, inseparable reading is figurative or "all the way around/through"**, and usually takes a direct object (übersetzen = translate, umfahren = drive round, durchsuchen = search). Present this as a tendency, not a rule.

A transitive inseparable verb takes haben, even when the root takes sein: ich bin gefahren, but ich habe den Stau umfahren, ich habe die Bank überfallen, ich habe es bekommen.

**Each prefix** (grades: T literal, M picture, O word to learn; the verbs are in `data.js` with examples)

| Prefix | Kind | Compass | Core | Productive senses | T | M | O |
|---|---|---|---|---|---|---|---|
| auf | s | ↑ | up, onto, open | setting up, opening, starting, onto paper, using it all up | aufstellen, aufstehen, aufgehen, aufschreiben | auflegen (hang up), aufgeben, aufnehmen (record), auffallen, aufhalten | aufhören |
| ab | s | ↓ | down, off, away | putting down, switching off and ending, less, copying from | abstellen, absetzen, abgeben, abfahren, abschreiben | abnehmen, ablegen, absprechen, abhalten | (eine Prüfung) ablegen as a phrase |
| ein | s | → | in, into | setting and adjusting, into a group (hiring, including), switching on, into a state | einlegen, einnehmen, eingeben, einziehen, einschreiben | einstellen, einfallen, einhalten, einsehen, eingehen | |
| aus | s | ← | out, outward | showing in public, issuing, switching off, to the end | ausstellen, ausgeben, ausgehen, ausziehen, aussprechen | aussehen, ausfallen, aushalten, auskommen, ausschreiben | |
| vor | s | ↗ | in front, forward, before | presenting, preparing in advance, showing how, putting forward | vorlegen | vorstellen, vorschlagen, vornehmen, vorkommen, vorziehen, vorsehen | |
| nach | s | ↙ | after, behind | following, copying, checking, making up later | nachkommen, nachsprechen, nachlegen | nachsehen, nachgeben, nachgehen (a clock) | |
| an | s | ↘ | at, onto, toward: contact | starting, attaching and putting on, addressing someone | ankommen, ansprechen, ansehen, anschreiben | annehmen, anziehen, anhalten, anlegen, angeben | |
| zu | s | ↖ | toward; closed; added | delivering, shutting and blocking, adding, agreeing | zugehen, zuziehen, zufallen, zusehen | zunehmen, zugeben, zustellen, zulegen | |
| mit | s | (row) | with, along | taking part, taking notes | mitnehmen, mitkommen, mitfahren, mitschreiben | | |
| um | d | path: around / turn over | around; over; change | stressed: change, convert, turn or fall over; unstressed: all the way around, avoiding | umstellen (s, i), umziehen, umfallen, umfahren (s, i), umgeben | umsetzen, umgehen (s), umschreiben (i) | umkommen (die) |
| über | d | path: over | over, across | stressed: literally over or across; unstressed: figurative (transfer, too far, missing) | übersetzen (s), übernehmen, übergeben, überziehen (s) | übersetzen (i), überlegen, übersehen, überfallen, überfahren, überstehen | |
| unter | d | path: under | under, below, between | stressed: literally down below; unstressed: figurative | untergehen, unterschreiben | unterkommen | unternehmen, sich unterhalten |
| durch | d | path: through | through | stressed: through and out, to the end; unstressed: all through | durchgehen, durchhalten, durchfahren, durchsehen | durchfallen, durchsetzen, durchkommen | |
| be | i | lens: target | aims the action at a direct (accusative) object | sprechen über → besprechen; antworten auf → beantworten; verbs from adjectives (befreien) | besprechen, beschreiben, befahren | behalten, belegen, besetzen, bestehen | bestellen, bekommen, sich benehmen, begehen, sich beziehen |
| ver | i | lens: deflect | into a new state; off course or wrong; away, lost or blocked | verbessern, verändern; sich verlaufen/verfahren/versprechen/verschreiben; verlieren, vergehen, verstellen (block) | sich verfahren | verlegen, versetzen, vergeben, vergehen, verfallen, verstellen | verstehen, versprechen (promise), sich verhalten |
| ent | i | lens: remove | away from, out of; undoing; coming into being | entnehmen, entkommen, entziehen; entdecken, entstellen; entstehen | entnehmen, entkommen, entziehen | entstehen, entfallen, entgehen, entstellen | enthalten, entsprechen |
| er | i | lens: reach | to a result, to the end | erreichen, erstellen, erfinden; erschlagen | | erstellen, erziehen, erfahren (history) | erhalten, ersetzen, sich ergeben |
| zer | i | lens: shatter | to pieces | zerbrechen, zerlegen, zerfallen, zerstören | zerlegen, zerfallen | | |
| ge | i | lens: no picture | no shared meaning in verbs today | verbs: learn as words; nouns: a collection or result (das Gebirge, das Gestell, das Gespräch) | | | gefallen, gehören, gestehen |
| miss | i | (row) | wrongly, badly | missverstehen, misslingen | | | |
| emp | i | (row) | a form of ent- before f; three verbs | empfehlen, empfangen, empfinden | | | all three |
| wider | i (mostly) | (row) | against | widersprechen, widerstehen | both | | (not wieder = again) |

**Checks against the owner's reference table.** Most of it holds. These points need changing before they go into the app:
1. **ein- "cessation".** "Stop" is a sense of einstellen only (die Produktion einstellen). It is not an extension of ein- in general, so it goes on the verb, not the prefix card. ein- in general also gives "switch on" (einschalten), which his table leaves out and which pairs with aus- "switch off".
2. **an- "queueing"** is a sense of sich anstellen only. anstellen = switch on is colloquial and regional; anschalten or einschalten is standard. The prefix card shows "starting" (anfangen, anschalten) instead.
3. **ausstellen = turn off** is colloquial ("Stell das Radio aus"). It stays as a marked third sense.
4. **um- "surround"** is the inseparable reading (die Polizei umstellt das Haus, hat umstellt). "Rearrange" and "convert" are separable (umgestellt). The card must split them, or umstellen teaches a wrong participle.
5. **bestellen** = order (goods), appoint (formal), cultivate (a field). Correct, but none of these follows from be- + stellen for a learner. Grade: word to learn. The be- card keeps its true job (it makes the object direct, and the verb takes haben).
6. **ver-** is three senses as he wrote. verstellen covers misadjust, block (den Weg verstellen) and disguise (die Stimme verstellen; sich verstellen = pretend). Correct.
7. **ent-**: entstellen (distort, disfigure) and entstehen (come into being) are correct.
8. **zer-**: correct, and there is no zerstellen. The compass shows zer- faded for stellen and says so.
9. **ge- "result / collective / completion"** is true of **nouns** (das Gebirge from Berg, das Gestell from stellen, das Gespräch from sprechen). In modern **verbs**, ge- has no meaning a learner can use: gefallen, gehören and gestehen have to be learned as words. "Completion" is the historical sense. Keep his example as a mechanics fact: gestehen and stehen share the participle gestanden.
10. **Dual prefixes** follow the stress rule above. wider- is inseparable in the common verbs; wieder- is separable except in wiederholen (repeat).

**The "how" line and its four labels** (shown on every verb):
- **Literal**: the prefix's spatial sense plus the root's sense gives the meaning.
- **Picture (a way to remember it, not its history)**: one figurative step from a real sense of the prefix (einfallen: an idea falls into your head). It is a memory aid and is never claimed as etymology.
- **History**: only where the history is documented and helps (erfahren first meant "reach by travelling, explore"; entdecken = take the cover off). There are few of these, and each must cite a dictionary (Kluge or DWDS) in the authoring file.
- **Word to learn**: no explanation is offered beyond false-friend or mechanics notes (bekommen ≠ become; hat bekommen).

---

## 5. The suffix model (gender rules)

Existing: `content/clusters/de.json` already has 19 suffix rules with `pos`, `art`, `note` and a validated `except` list (the validator fails a noun whose article contradicts its suffix unless it is listed). Build on it.

| Ending | Makes | From | Article | Rule and exceptions | Chain examples |
|---|---|---|---|---|---|
| -ung | noun | verb | die | always; plural -ungen. Not every verb has an -ung noun (see bare stem) | die Vorstellung, Ausstellung, Bestellung, Einstellung, Zustellung |
| -heit | noun | adjective | die | always | die Sicherheit, Wahrheit |
| -keit | noun | adjective | die | always; after -bar, -lich, -sam, -ig (and -er, -el): Haltbarkeit, Möglichkeit, Einsamkeit | die Vorstellbarkeit, Verständlichkeit |
| -schaft | noun | noun or adjective | die | always | die Wissenschaft, Bereitschaft |
| -er | noun | verb | der | der when it names a person or a tool that does the action; -in for a woman (die). Not every noun ending in -er is der (die Butter, das Fenster); the rule only covers nouns made from verbs | der Zusteller, Aussteller, Empfänger, Schalter, Behälter |
| -nis | noun | verb | das | mostly das; die Erlaubnis, die Kenntnis, die Erkenntnis (already in `except`) | das Verständnis, Ergebnis, Erlebnis |
| bare stem | noun | strong verb | der (mostly) | often with a vowel change; there is no -ung form (no "Umziehung"). Exceptions to show: die Ankunft (ankommen), das Angebot (anbieten) | der Umzug, Anzug, Vorschlag, Anruf, Ausgang |
| das + infinitive | noun | any verb | das | always | das Versprechen, das Essen |
| -bar | adjective | verb with an object | none | "can be done": lesbar, verstellbar, vorstellbar, ausziehbar. Use only attested forms (no "ziehbar") | |
| -lich | adjective | verb or noun | none | from a verb, often "can be done": verständlich, erhältlich, begreiflich | |
| -sam | adjective | verb | none | "tending to": sparsam, biegsam, aufmerksam | |

Corrections to the brief:
- **"Umzug as the ablaut exception to -ung"**: Umzug is not an -ung noun with an exception. It belongs to a separate pattern (a bare stem noun from a strong verb), which is mostly der. Teach that pattern as its own row, because it covers many common nouns: Anzug, Vorschlag, Anruf, Abschluss, Ausgang.
- **A chain is a tree.** vorstellbar comes from vorstellen, not from Vorstellung, and Vorstellbarkeit comes from vorstellbar. -bar and -lich attach to verbs; -keit attaches to adjectives.
- Vorstellbarkeit is a real but rare word. The chain marks it "(rare)". Use common chain ends where possible: unvorstellbar, die Verständlichkeit, die Haltbarkeit (das Haltbarkeitsdatum).

---

## 6. Cards and FSRS

One new deck, **`build`**, in the shared FSRS schedule (`domain/fsrs.js`). Add the tags to `domain/itemids.js` `TAGS`; all are two letters, so `tagOf()` works as it is.

| Card id | Item id (knowledge) | Front → back | Graded by |
|---|---|---|---|
| `PX:<p>.see` | `PX:<p>` | the motion plays → tap the prefix on the compass | tap: first try right = Good, else Again |
| `PX:<p>.say` | `PX:<p>` | "ver-" → say its senses and whether it splits; reveal the prefix card | grade4 (self) |
| `PD:<verb>` | `PV:<verb>` → `W:<lemma>` when the verb is in the word list | root + prefix (+ both glosses) → predict the meaning and how derivable it is → reveal | grade4 (self); the calibration guess is logged, not graded |
| `PV:<verb>` | same as PD | English meaning (+ "separable" hint) → type the infinitive | grade.js, strict |
| `PS:<frame>.<form>` | `PS:<frame>.<form>` | the sentence with gaps + infinitive + frame name → type the verb pieces ("habe angerufen") | grade.js, strict on order, ge- and particle; then the machine plays it |
| `SX:<suffix>` | `SX:<suffix>` | "-ung" → tap der / die / das (adjective endings: say what it makes, self-graded) | tap / grade4 |
| `PW:<word>` | `PW:<word>` → `W:<id>` when in the word list | "vorstellen + -ung" → type "die Vorstellung" | grade.js, strict article (as nouns today) |

- `<verb>` is an authored id, stable forever: the infinitive slug without "sich", plus `-s`/`-i` for the two readings of a dual verb (`umfahren-s`, `umfahren-i`, `vorstellen`). Card ids never change; list them in `tests/fixtures/shipped-ids.txt` with `node tools/shipped-ids.mjs --write`.
- **Resolver** (`domain/knowledge.js resolver()`): deck `build`. `PX:<p>.*` → `PX:<p>`; `PD:`/`PV:<verb>` → `W:<lemma>` when the verb has a `lemma` in the word list, else `PV:<verb>`; `PW:<w>` → `W:<id>` likewise; `PS:` and `SX:` as they are. So a verb he learned in a word cluster (W:) counts here, and the reverse.
- **Concept score** per prefix: `knowledge.concept('PC:<p>', ['PX:<p>', …its verb items])`, for the hub and the compass marks.
- **Order of new items** (`compose()` as in clusters/items.js, with a stage gate):
  1. PX of the 8 compass prefixes plus be and ver (10 cards, about 3 a day);
  2. a prefix's verbs open after its PX card's first Good. Within them: roots he knows first (`W:<root>.verb` recall, then zipf), then T before M before O, then level up to B1 first, interleaving roots × prefixes (never two verbs of the same root in a row, never three of the same prefix);
  3. PS frames open per prefix kind after 6 verbs of that kind have been seen;
  4. SX rule cards first, then the PW words of each rule.
- **Daily new cap**: its own budget line in `domain/budget.js` (proposal: 6 new a day across the deck, 0 from exam−1; it counts toward Today's minutes), so the B1 pool's quota is not eaten by this deck.
- **Review rounds** mix all card types, due first by lowest recall (as elsewhere). Each type reuses the round's card shell; the compass, machine and chain are the reveals.
- **Split or stay writes no FSRS cards.** It is a speeded binary guess (50 % by chance), which makes it noisy evidence. It logs to kv `build.game` (`{day, n, right, missed: [verb ids]}`), and its missed verbs move their PS frames to the front of the next round's new items.

---

## 7. Data: what exists and what to add

**Exists in `content/clusters/de.json`** (validated by `domain/clusters.js validateClusters`):
- `prefixes[21]`: id, label, kind (`separable` / `inseparable` / `both` / `word`), a one-line note and examples. The notes are correct.
- `morph[4252]`: every word has a stem; 401 prefixed verbs have `pre` and `sep`, and the validator already enforces "an inseparable prefix never separates". The dual-prefix verbs I spot-checked are right (umgehen sep, übersetzen insep, durchsetzen sep, wiederholen insep).
- `families[146]` with members; `suffixes[19]` with articles and `except`.

**Gaps found** (fix in the authoring sources, not by hand in the JSON):
- **103 of the 170 verbs in the prototype are not in the word list**, including common A1-B1 verbs: aussehen, ansehen, aufschreiben, vorstellen / sich vorstellen, aufnehmen, anhalten, eingeben. `setzen.verb` is missing too (only `sich_setzen.verb` exists). That is why PV/PD ids must not depend on W: ids.
- Glosses that hide the prefix sense: `ausstellen.verb` = "to issue (a document)" only (add "exhibit"); `einstellen.verb` = "hire; take on" only (add "adjust, set").
- Morph bugs: `die_Vorstellung` has stem `vorstell` with `pre: ['vor']` (the prefix is counted twice); `der_Empfänger` has no `pre`/`suf` (should be `emp` + `fang` + `er`).
- `prefixes` lacks the model fields below; there is no `wieder`, `fest`, `her/hin` card.

**Add** (authored in `authoring/clusters/build/*.yaml`, built by `tools/build-clusters.mjs` into new top-level keys of `content/clusters/de.json`, so it ships with the clusters file already loaded by Practice):

```jsonc
"prefixes": [ {                       // existing entries gain fields
  "id": "ein", "kind": "separable", "note": "…", "ex": […],
  "ring": "axis",                     // axis | path | lens | extra
  "pos": 90,                          // compass angle (axis only)
  "glyph": "in",                      // pictogram scene id
  "alt": "the object moves into the box",   // text equivalent of the motion (a11y)
  "core": "in, into",
  "short": "in, into",
  "senses": [ { "en": "setting, adjusting", "ex": ["einstellen"] }, … ],
  "opp": [ ["aus", "in / out"] ],
  "sep": "…", "insep": "…",           // dual only
  "word": "einstellen can also mean stop …"   // caveat, optional
} ],
"roots": [ { "id": "stellen", "lemma": "stellen.verb", "en": "put (upright), place", "obj": "upright",
             "pres1": "stelle", "pp": "gestellt", "aux": "hat" } ],
"pverbs": [ { "id": "umstellen-s", "root": "stellen", "pre": "um", "inf": "umstellen", "kind": "s",
              "refl": null, "lemma": null, "grade": "T", "how": "lit",
              "en": "rearrange; switch over (to)", "why": "um (stressed) = change …",
              "ex": "Wir stellen die Möbel um.", "exEn": "…", "pp": "umgestellt", "aux": "hat",
              "dual": "umstellen-i", "level": "B1", "src": "Duden|DWDS" } ],
"frames": [ { "id": "aufstehen", "verb": "aufstehen", "en": "get up",
              "forms": { "pres": [["S","Ich"],["R","stehe"],["A","um sieben"],["P","auf"],[".","."]], … } } ],
"chains": [ { "id": "vorstellen", "nodes": [ { "id": "n2", "from": "n1", "add": "ung", "side": "suf",
              "word": "Vorstellung", "art": "die", "cls": "noun", "lemma": "die_Vorstellung", "en": "…", "note": "…" } ] } ],
"suffixes": [ { …existing, "short": "after -bar, -lich, -sam, -ig" } ]   // plus rows "stem" and "inf"
```

**Validation to add to `validateClusters`** (all mechanical, all in node):
- every `pverbs.pre` is in `PREFIX_SET`; `kind` agrees with `INSEPARABLE` (an inseparable prefix is never `s`); when `lemma` is set, `kind === 's'` agrees with `morph[lemma].sep`;
- participle shape: separable → `pp` starts with `pre + 'ge'`, unless the next prefix in `morph` is inseparable (vorbereitet, beibehalten); inseparable → `pp` starts with `pre` and does not start with `pre + 'ge'` unless the root's own participle begins with `ge` and the result is `pre + rootPP.slice(2)` (vergeben, übergeben; gefallen = ge + fallen);
- the `aux` is `hat` when the verb is inseparable and transitive (flagged for review when the root takes sein);
- separable examples in a main clause contain the particle as a separate token, before `. ! ? ,` (or the verb is in the imperative or under a modal: flag those for a human check);
- each `frames.forms` uses keys from {S,X,O,A,N,C,R,P,G,Z,.}; separable frames have G only in `perf` and Z only in `zu`; inseparable frames have no G;
- chain nouns: `art` matches the suffix rule or the noun is in that suffix's `except`; when `lemma` is set, the word list's article agrees;
- `how: hist` needs `src`; `grade: O` must have `how: word`;
- a German-text privacy and language pass as for every content file; every sentence is read by a human (owner or reviewer) before it ships. The prototype's 170 sentences are a starting point, checked once.

---

## 8. Motion choreography

All motion goes through `core/motion.js` (flip, countTo, haptic, reduced) and WAAPI with the kit's tokens. No GSAP: every move here is a FLIP, a path follow or a keyframe pair, which the kit and WAAPI already do. A vendored GSAP (about 70 kB) would add a second animation system for nothing. The pictogram path-follow is a 20-line rAF loop (`picto.js tween`) that runs only while moving.

| Moment | Choreography | Duration, easing | Reduced motion |
|---|---|---|---|
| Prefix tap (compass) | chip press; pictogram: the root's object travels the dashed path (door shuts after zu, flag fills for er, brackets close on the target for be, the object fades off course for ver, shards for zer) | press 90 ms; path 900 ms ease-in-out; extras 320-560 ms after | scene drawn in its end state; the dashed path and arrow stay, so the diagram still teaches |
| Prefix joins the root | a copy of the chip flies from the ring to the word on a short arc (18 px lift, scale 0.6 → 1, translation only). **Separable**: lands with a 3 px settle; the joint line shows; the stress dot pops under the prefix. **Inseparable**: the 6 px gap closes, the weld line draws under both pieces, the stress dot pops under the stem | flight 520 ms ease-out; settle 240 ms spring-snappy; weld: close 160 ms ease-in, line 240 ms (delay 120), dot 420 ms spring-pop (delay 260) | the word appears assembled with joint or weld and dot |
| Reveal ladder | the pin (accent: his guess) slides from the guessed grade to the true one | 380 ms spring-snappy | pin at the truth; the feedback line says what he guessed |
| Drill answer | right: chip pop 1 → 1.12 → 1, then the flight; wrong: 300 ms damped nudge, right chip outlined, the motion replays | 420 ms spring-pop | no pop or nudge; outline and text |
| Table focus | other cells fade to 0.18; the column's cells pop 0.7 → 1 on a stagger | fade 160 ms; pop 380 ms spring-pop, 28 ms stagger, max 14 | instant dim |
| Machine frame change | FLIP every tile by its key. **The particle is the hero**: it lifts (10-28 px by distance), travels and lands, translation only. Other tiles move snappily; ge- and zu drop into the gap between prefix and stem; leaving tiles fade upward; slot labels ("Position 2", "End") fade in after the move | particle 620 ms ease-in-out; others 420 ms spring-snappy; ge/zu 560 ms spring-pop, delay 260; leaving 160 ms ease-in; labels 200 ms, delay 460 | 140 ms crossfade of the line |
| ge- turned away | inseparable Perfekt (and vorbereiten): a ghost ge- tile drops toward the stem, bounces off and rises away; the stem dips 2 px on contact | 900 ms total, delay 300 | no ghost; the rule line says "No ge-" |
| From the infinitive | the tray's infinitive is the FLIP origin: the stem flies to position 2 and conjugates (text swap), the particle flies to the end | as above | crossfade |
| Chain grow | the new row rises 8 px; the edge draws from the parent; the new piece slides on from its side (from the left for a prefix, the right for a suffix); the word-type label rolls (Verb ↑ out, Noun ↑ in) | row 300 ms; edge 240 ms; piece 420 ms spring-snappy, delay 180; label 160 / 380 ms, delay 420 / 470 | the row appears complete |
| Article lands | the article drops into place; the dotted arc draws from the ending to the article; that ending underlines in accent in the chart for 1.3 s | 560 ms spring-pop; arc 320 ms, delay 200 | article and arc appear; no underline pulse |
| Split or stay | word enters from 24 px right. Separable: the joint flashes, the stem slides left by the prefix's width, the prefix hops (16 px) to the end: "fahren um". Inseparable: the weld line draws. Wrong: card nudge | enter 300 ms spring-snappy; split 540 ms ease-in-out; weld 220 ms; hold 650 ms right, 1.5 s wrong | final states only; holds unchanged |
| Haptics | haptic() on a right answer in the drill, the game and the article guess (first three in a row only) | | kept (not motion) |

Rules kept from DESIGN.md: one primary motion per moment (on the compass the path plays while the chip flies; both describe the same event, and the flight ends after the path's midpoint); input is never blocked (taps during a flight cancel it and jump to the end state); nothing loops at rest; the round chrome holds still.

**Colour.** Accent only for "you, now": the caret, focus rings, the round's current segment, the pin that marks his guess, and the chart's just-used ending. The pictogram path is ink-3 dashed, stress dots are ink, and the Table's selected column is outlined in ink. (The first prototype pass used accent for the path and the stress dots; it was changed, see Section 10.) Role colours appear only on the machine's grammar tiles, which is their documented use.

---

## 9. Accessibility

- **Compass**: a group of real buttons with a roving tabindex. Arrow keys move around the ring by angle; Tab moves between the ring, the path row and the lens row. Each chip's accessible name gives the prefix, its core meaning and, for this root, the grade or "no common verb". In the drill the names give the prefix only, so the answer does not leak. Chips are at least 44 × 44.
- **Pictogram**: `role="img"` with the prefix's `alt` text ("auf-: the object rises"; "zer-: the object breaks into pieces"). The motion always has a text equivalent on the prefix card.
- **Word assembly**: the word has an aria-label that says where the stress is ("aufstellen, stress on auf"). The joint and weld are drawn with lines, not colour.
- **Derivability** is coded by shape (solid, hatched, outline with dot, small dot), never colour alone, with a legend. Knowledge uses Explore's ink encoding and states in words. Forced colours: solid cells become CanvasText, and selections get Highlight outlines.
- **Table**: a real `<table>` with `th scope`, a group-header row and a sticky row header. Cells are buttons labelled "einstellen: adjust, set; hire. picture."
- **Machine**: the sentence is real text in reading order (`lang="de"`). After each frame change, an `aria-live="polite"` region announces the sentence and the rule line. Slot labels are aria-hidden, because the rule line says the same thing in words.
- **Your turn / PV / PW**: the existing answer field (18 px, never under 16 px), with the existing grader and its feedback.
- **Split or stay**: buttons plus ← and → keys. The 60-second limit needs a way out to meet WCAG 2.2.1 (Timing Adjustable): a setting "Untimed" turns it into 20 items without a timer. The timer is a 2 px hairline bar (never accent) and an `aria-valuenow` progressbar.
- **Reduced motion**: Section 8. Every state is legible as a still.
- **Language**: German is set in `lang="de"` everywhere, so VoiceOver switches voice. Stress is shown visually. edge-tts cannot be made to stress umFAHren vs UMfahren on demand, so dual pairs get no audio until that is solved (open question 4).

---

## 10. Critique log (what the screenshots showed and what changed)

1. **The page scrolled sideways at 390 px.** Visually hidden `.sr` spans inside the scrolling chip row were positioned against the page. Chips are now `position: relative`, and grid children have `min-width: 0`.
2. **The prefix card printed "[object HTMLSpanElement]"**: nested arrays were not flattened. Fixed with `flat(Infinity)`.
3. **The mechanics line made up German.** With a root that has no verb for the prefix, it printed "ich zerstelle". It now uses a real verb (this root's if one exists, else the first verb with that prefix). This rule goes into the build: never generate German forms, only show authored ones.
4. **The drill leaked answers.** Faded chips (no verb for this root) and the chips' accessible names showed the answer. The drill now uses plain chips with the name only.
5. **Machine labels sat in the wrong place**, because they were measured mid-FLIP. They are now placed from layout offsets and fade in after the move.
6. **The participle broke across lines** ("auf ge / standen"). The pieces of one verb, plus the full stop, now sit in a no-wrap group.
7. **The vorbereiten Perfekt rule said "ge- goes between prefix and stem"**, which is wrong for vorbereitet. Frames with an inner inseparable prefix now get their own rule, and they get the ge- bounce.
8. **Chain edges ran through the glosses.** Edges now start under the parent's text and run in the indent gutter. The article moved next to its noun. The rule arc goes over the word, from the ending to the article.
9. **"+ -bar" sat between a parent and its first child**, so the tree read out of order. Grow buttons now come after the branch they extend, labelled "vorstellen + -bar".
10. **The game's split animation slid the prefix across the stem**, and the text overlapped. Now the stem moves to the front and the prefix hops to the end, which mirrors the sentence.
11. **Accent overuse.** The dashed path and the stress dots were accent. They are now ink-3 and ink (Section 8).
12. **The grade4 suggestion dot misled.** It suggested Hard when his derivability guess was wrong, but the grade is about the meaning. The suggestion was removed, and the row is labelled "Did you know what it means?".

Still weak, and to tune in the build:
- **The pictograms are small** (about 160 px wide on a phone). vor/nach need the "facing" cue to read; the prototype adds a head with a nose triangle on the post.
- **The Table on a phone** shows 9 of 19 columns. Consider a "column lens" on phones: one prefix column at a time, swiped.
- **The stress dot under the word sits close to the compass ring** at 390 px. Give the word slot 6 px more space.

---

## 11. Phasing

The B1 exam was a few days away when this was written, and the B1 work came first.

| Phase | When | Scope | Content work |
|---|---|---|---|
| 0 (optional) | before the exam, only if it costs under 2 hours | Split or stay on Today, using only the existing `morph.sep` of word-list verbs (about 400) and their existing examples. It helps with Perfekt and word order in Schreiben | none; filter to verbs with an example |
| 1 | the week after the exam | data model and validation (Section 7); deck `build`, TAGS and resolver; hub; compass with prefix cards (PX see/say) and the drill | author `prefixes` fields for 21 prefixes and `roots` for 15 |
| 2 | +1 week | verbs: PD/PV cards, reveal with ladder, Table | `pverbs` (start from `data.js`, 170 verbs), human-checked |
| 3 | +1 week | the sentence machine, PS cards, "from the infinitive" | `frames` (9 → about 40: each common particle and each inseparable prefix with at least one frame; sein verbs; two-prefix verbs) |
| 4 | +1 week | suffixes: chains, article chart, SX and PW cards; join Explore (a "Word building" mode or links from word cards) | `chains` (5 → about 30), suffix fields, the stem and infinitive rows |
| 5 | after that | mixed review tuning, unlock pacing, Today integration, `build.game` feeding PS | |

Gates for every phase, as in CLAUDE.md: `npm test`, `test:tz`, `typecheck`, `check:privacy`, `check:dates`, `check:content`; 390 px WebKit light and dark plus reduced motion; the grading corpus stays at zero false positives (PV and PW use the strict grader; PS is strict on word order).

---

## 12. Open questions for the owner

1. **The compass**: your sketch has vor at the top. I put auf at the top (up/down is auf/ab in German) and vor on the forward diagonal. Is that right for you, or should the ring keep your layout?
2. **Budget**: should this deck get its own daily new-item cap (proposed: 6 a day, none from the day before the exam), or share the B1 quota?
3. **Before the exam**: build the 60-second game now (Phase 0), or nothing until after?
4. **Audio**: edge-tts can't be told where the stress goes. For dual pairs (UMfahren / umFAHren), should we record the owner, use another voice, or show stress visually only?
5. **Tile colours** in the machine: keep the grammar role colours (verb, helper, ge-/zu), or use plain tiles with only the joint and weld?
6. **Roots**: are these 15 the right ones (stellen, legen, setzen, nehmen, geben, kommen, gehen, ziehen, fallen, halten, sprechen, schreiben, sehen, fahren, stehen)? Candidates to add: schlagen, bringen, lassen, tragen, laufen, rufen, hören, machen.
7. **Regional and colloquial senses** (anstellen = switch on, ausstellen = switch off): keep them, marked "colloquial", or leave them out?
8. **The game and FSRS**: is it right that the game writes no cards and only feeds the sentence cards?
9. **The Explore map**: add "Word building" as a mode (prefix columns as groups), or only link from the word card ("Same prefix: …")?

## Owner decisions (2026-10-05)
- Compass: auf- up, vor- forward diagonal, ab- down (designer's layout).
- Daily cap: its OWN small cap (default 5 new/day, setting), never from the B1 allowance.
- Timing: build the FULL mode now.
