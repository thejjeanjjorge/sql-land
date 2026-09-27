#!/bin/bash
# Double-click in Finder to start SQL Land on macOS.
cd "$(dirname "$0")" || exit 1

# Show the SQL Land logo on this file in Finder (once; harmless if it fails).
if [ -f logo.png ] && [ ! -f .icon-set ]; then
  osascript -l JavaScript -e 'ObjC.import("AppKit"); const dir = $.NSFileManager.defaultManager.currentDirectoryPath.js; $.NSWorkspace.sharedWorkspace.setIconForFileOptions($.NSImage.alloc.initWithContentsOfFile(dir + "/logo.png"), dir + "/Start SQL Land.command", 0)' >/dev/null 2>&1 && touch .icon-set
fi

pause_and_exit() {
  read -n 1 -s -r -p "Press any key to close this window."
  echo
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "SQL Land needs Node.js, which is not installed on this computer."
  echo "Opening https://nodejs.org - install the LTS version, then double-click this file again."
  open https://nodejs.org
  pause_and_exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"; then
  echo "SQL Land needs Node.js 20.19 or newer. This computer has $(node --version)."
  echo "Opening https://nodejs.org - install the LTS version, then double-click this file again."
  open https://nodejs.org
  pause_and_exit 1
fi

if node -e "fetch('http://localhost:5173/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
  echo "SQL Land is already running. Opening it in your browser."
  open http://localhost:5173/
  exit 0
fi

# Install on the first run, and again whenever package-lock.json changes.
if ! node -e "const fs=require('fs');try{process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"; then
  echo "Setting up SQL Land. The first time can take a minute..."
  if ! npm install --no-audit --no-fund; then
    echo
    echo "Setup failed. Check your internet connection and try again."
    pause_and_exit 1
  fi
fi

echo
echo "Starting SQL Land. Your browser will open in a moment."
echo "Keep this window open while you practice. Close it to stop SQL Land."
echo
npm start
