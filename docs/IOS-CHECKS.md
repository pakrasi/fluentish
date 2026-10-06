# iPhone checks for the platform services

Run these on the iPhone after a change to `src/services/` (speech, voice, audio, share, haptics) or `core/link.js`.
Use the place you study in every day (a Safari tab or the Home Screen icon; they keep separate data). The browser
tests cover the flows in WebKit, but they can't cover the mic, the speaker, the mute switch, haptics or the share sheet.
Each check takes under a minute.

## Mic
- [ ] Practice › Sprechen › Mic check: the first tap asks for the microphone once; it hears a read sentence.
- [ ] A speaking situation with Check with the mic on: it hears the answer and suggests a grade.
- [ ] Teil 2 talk: run 1 records, and the take plays back on the result screen.
- [ ] Exam › Sprechen: a part records, plays back, and shows its length. Lock the phone during a take, unlock: the take is kept.

## Audio, first play
- [ ] After a fresh start (swipe the app away, open it again), the first ▶ on a word in Look up plays at once on the first tap.
- [ ] Mute switch on: note what happens (a recording stays silent; nothing else should break). Mute switch off for the rest.
- [ ] A speaking situation: the line plays when the card opens, or the card says "Tap to play the line." Tap ▶: it plays.
- [ ] A line with no recording (offline): the device voice reads it in German, not a "Multilingual" voice.
- [ ] Script › Listen reads the sentences with a German voice, and the words follow along.

## Hören play limits
- [ ] Exam › Hören › Ton prüfen plays the first clip.
- [ ] Teil 1, text 1: Abspielen plays once, "Zweites Hören in 5 s" counts down, the second hearing starts by itself, then "Keine Wiedergabe mehr" and the button is off.
- [ ] Teil 2: Abspielen starts the reading time; "Lesezeit überspringen" starts the audio. One play only.
- [ ] Reload the page during the module: the used plays stay used.
- [ ] While audio plays, the Teil tabs and Back/Next are locked.

## Haptics
- [ ] A correct typed answer gives a light tap, and the keyboard stays up right after it.
- [ ] Grading a situation or a Word building card gives the same tap.

## Share
- [ ] Profile › Data › Export opens the share sheet with `fluentish-<date>.json`. Save to Files works. Closing the sheet does nothing else.
- [ ] Exam › Sprechen › Save file on a take opens the share sheet with the audio file.

## Device link
- [ ] On the Mac, `b1-token.py --reuse` shows a QR code. Scan it with the iPhone camera: Fluentish opens on Profile with "Device linked.", the address bar shows `#/profile` with no token, and Connections says the device is linked.
- [ ] The QR opens Safari. If you study from the Home Screen icon, link it from Profile › Connections instead (it has its own storage).

## Speaking outdoors

### What went wrong outdoors (diagnosis, round 5)
Read from the code on `main` 5d4aca4, with the platform facts from MDN's browser-compat data (8.1.4) and WebKit:
- **Recognition ends early.** `listen()` was one shot: Safari's recogniser (the Siri engine, `webkitSpeechRecognition`
  since iOS 14.5) ends the session on `no-speech`, on a gust it can't segment, or on a network blip, and the card said
  "Nothing heard". Only the Teil 2 talk restarted it.
- **Low confidence ignored.** Only `results[i][0].transcript` was read. `confidence` (0 to 1, iOS 14.5+) and the other
  `maxAlternatives` were dropped, so a guess in the wind was graded like a clean take.
- **Wrong guesses.** `lang` is fixed to the course locale, so the recogniser doesn't switch language, but in noise it
  maps traffic and wind onto short German words, or keeps English fragments. The check then misses the chunk.
- **The level never drops.** Safari ends an utterance on silence. With wind or traffic there is no silence, so a take
  ran until he tapped stop, and the interim text kept changing under noise. There was no meter to show it.
- **No capture processing.** `recorder.js` asked for `{ audio: true }`. On iOS Safari only `echoCancellation` is
  supported (since iOS 11); `noiseSuppression` and `autoGainControl` are not (MDN BCD), so they are requested as
  plain booleans, which a browser may ignore and never fail on. They help on a Mac.
- **Grading.** `sim.js micCheck` suggested Again whenever the chunk was missing from the transcript, and the table
  said "Wrong". A misheard answer outdoors was a suggested Again; Enter takes the suggestion.
