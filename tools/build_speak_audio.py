#!/usr/bin/env python3
"""Synthesise the speaking-situation audio: one mp3 per line of content/speak/situations.json.

Run with the edge-tts venv (the same one as the b1-exam audio pipeline):
  ~/.venvs/fritz-audio/bin/python3 tools/build_speak_audio.py [--out DIR] [--force]

Each line's file name is already in the content (md5("<voice>|<text>").mp3, written by tools/build-speak.mjs), so
this script only fills in missing files. Monolingual German voices only (the *Multilingual* voices drift into an
American accent on German text). The other person speaks at +0 % (a real conversation is quick), the model answer
at -5 % (clear enough to shadow).

Output: media/speak/ by default. That folder is git-ignored: audio never goes into this public repository. It is
published next to the exam audio, in the b1-exam Pages site (docs/audio/speak/ there, served at
https://pakrasi.github.io/b1-exam/audio/speak/); copy the files or pass --out ~/pakrasi-lab/b1-exam/docs/audio/speak.
The dev server serves media/speak/ at http://localhost:8430/media/speak/, which the app tries first on localhost.

Checks, as in the audiobook pipeline: a clip shorter than max(0.6 s, 0.035 s per character) is truncated and is
synthesised again (up to 5 tries); the build stops loudly if one still fails.
"""
import asyncio, json, subprocess, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content" / "speak" / "situations.json"
RATE = {"other": "+0%", "answer": "-5%"}
SEM = asyncio.Semaphore(4)


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


async def synth(text: str, voice: str, rate: str, out: Path) -> None:
    need = max(0.6, 0.035 * len(text))
    err = None
    for attempt in range(5):
        try:
            async with SEM:
                await edge_tts.Communicate(text, voice, rate=rate).save(str(out))
            if out.exists() and out.stat().st_size > 1000 and duration(out) >= need:
                return
            err = f"too short ({duration(out):.2f}s < {need:.2f}s)"
        except Exception as e:  # noqa: BLE001
            err = e
        await asyncio.sleep(1.5 * (attempt + 1))
    out.unlink(missing_ok=True)
    raise RuntimeError(f"TTS failed for {out.name} ({voice}): {text!r}: {err}")


async def main() -> None:
    args = sys.argv[1:]
    out_dir = Path(args[args.index("--out") + 1]).expanduser() if "--out" in args else ROOT / "media" / "speak"
    force = "--force" in args
    out_dir.mkdir(parents=True, exist_ok=True)
    bank = json.loads(CONTENT.read_text())
    jobs = {}
    for it in bank["items"]:
        o = it["other"]
        jobs[o["audio"]] = (o["de"], o["voice"], RATE["other"])
        for a in it["answers"]:
            jobs[a["audio"]] = (a["de"], bank["voices"]["answer"], RATE["answer"])
    todo = {name: j for name, j in jobs.items() if force or not (out_dir / name).exists()}
    print(f"speak audio: {len(jobs)} clips, {len(todo)} to synthesise into {out_dir}")
    await asyncio.gather(*(synth(text, voice, rate, out_dir / name) for name, (text, voice, rate) in todo.items()))
    stale = [p.name for p in out_dir.glob("*.mp3") if p.name not in jobs]
    total = sum((out_dir / n).stat().st_size for n in jobs if (out_dir / n).exists())
    print(f"speak audio: done, {total / 1e6:.1f} MB for {len(jobs)} clips" + (f"; {len(stale)} files no longer used" if stale else ""))


if __name__ == "__main__":
    asyncio.run(main())
