#!/bin/sh
# The static checks CI runs (.github/workflows/checks.yml), all without a build step or installed dependencies:
# ruff and pyright on the Python, tsc on the editor's and the Worker's plain JavaScript (JSDoc types).
set -e
cd "$(dirname "$0")/.."
uvx ruff@0.7.4 check glideshow tools test
uvx pyright@1.1.389
npx --yes -p typescript@5.6.3 tsc -p editor
npx --yes -p typescript@5.6.3 tsc -p cloud
npx --yes -p typescript@5.6.3 tsc -p editor/local
echo "checks passed"
