#!/bin/bash
# espic slider patrol: Xvfb + chromium (CDP read-only) + xdotool (real X input)
set -u
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 1
chromium --no-sandbox --disable-dev-shm-usage --disable-gpu \
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
  --window-position=0,0 --window-size=1280,800 \
  --user-data-dir=/tmp/prof --no-first-run --disable-features=Translate \
  about:blank >/tmp/chrome.log 2>&1 &
sleep 4
exec node patrol.mjs "$@"
