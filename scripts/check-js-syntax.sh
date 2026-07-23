#!/usr/bin/env bash
# Syntax-checks every JS file in the repo. background.js is loaded as an
# ES module by the MV3 manifest but has a plain .js extension (no
# package.json to declare "type": "module"), so it needs the
# --input-type=module workaround; .mjs files are unambiguous.
set -euo pipefail

node --input-type=module --check <background.js

for f in $(git ls-files '*.mjs'); do
  node --check "$f"
done
