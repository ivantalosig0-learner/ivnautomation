#!/usr/bin/env bash
# Rebuild the Korean font subsets so every Hangul character used in the app ships offline.
# Run after adding Korean text anywhere under www/ (needs internet once).
set -euo pipefail
cd "$(dirname "$0")/../www"
KO=$(python3 - <<'PY'
import pathlib, re
chars = set()
for p in list(pathlib.Path('.').rglob('*.js')) + list(pathlib.Path('.').rglob('*.css')) + [pathlib.Path('index.html')]:
    chars |= set(re.findall(r'[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]', p.read_text(encoding='utf-8')))
print(''.join(sorted(chars)))
PY
)
echo "Hangul glyphs: ${#KO} → $KO"
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$KO")
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
fetch() { # family-query outfile
  local url
  url=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=$1&text=$ENC" | grep -oE 'https://[^)]+' | head -1)
  curl -sS -o "$2" "$url"
}
fetch "Black+Han+Sans" assets/fonts/bhs-ko.woff2
fetch "Gothic+A1:wght@600" assets/fonts/ga1-600-ko.woff2
ls -la assets/fonts/*-ko.woff2
