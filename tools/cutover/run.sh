#!/bin/bash
# Cutover rehearsal on one local origin (docs/CUTOVER.md › Test evidence). Builds old and new copies of the two old
# sites from git, this Fluentish checkout as /fluentish/, then runs cutover-test.js in Chromium and WebKit.
#   bash tools/cutover/run.sh            LD and B1 default to the usual checkouts; override with LD=… B1=…
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FL=$(cd "$HERE/../.." && pwd)
LD=${LD:-$HOME/language-doors}; B1=${B1:-$HOME/pakrasi-lab/b1-exam}
W=$(mktemp -d "${TMPDIR:-/tmp}/cutover.XXXXXX"); export CUTOVER_WORK=$W
mkdir -p "$W"/{ld-old,ld-new,b1-old,b1-new}
git -C "$LD" archive origin/main | tar -x -C "$W/ld-old"
git -C "$LD" archive cutover | tar -x -C "$W/ld-new"
# docs/audio is left out (135 MB); the stubs never load it
git -C "$B1" archive main docs ':(exclude)docs/audio' | tar -x -C "$W/b1-old"
git -C "$B1" archive cutover docs ':(exclude)docs/audio' | tar -x -C "$W/b1-new"
rsync -a --exclude node_modules --exclude .git "$FL/" "$W/fluentish/"
! curl -s -o /dev/null localhost:8462 || { echo "port 8462 is busy"; exit 1; }
python3 "$HERE/fake-origin.py" 8462 >/dev/null 2>&1 & SRV=$!; trap 'kill $SRV 2>/dev/null; playwright-cli -s=cutover close >/dev/null 2>&1; rm -rf "$W"' EXIT; sleep 1
for b in chromium webkit; do
  curl -s 'http://localhost:8462/__set?ld=old&b1=old' >/dev/null
  playwright-cli -s=cutover close >/dev/null 2>&1
  if [ $b = webkit ]; then playwright-cli -s=cutover open about:blank --browser=webkit --device="iPhone 14" >/dev/null; else playwright-cli -s=cutover open about:blank >/dev/null; fi
  playwright-cli -s=cutover --raw run-code --filename="$HERE/cutover-test.js" > "$W/$b.json"
  python3 - "$W/$b.json" $b <<'PY'
import json, sys
d = json.loads(json.load(open(sys.argv[1])))
print(f"{sys.argv[2]}: {sum(s['pass'] for s in d['steps'])}/{len(d['steps'])} checks, {sum(m['pass'] for m in d['map'])}/{len(d['map'])} links, fails: {d['fails'] or 'none'}")
PY
done
