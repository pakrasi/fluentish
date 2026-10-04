#!/bin/sh
# Run once per clone: points git at the versioned hooks in .githooks/ (privacy and date gates).
cd "$(dirname "$0")/.." && git config core.hooksPath .githooks && chmod +x .githooks/* && echo "hooks installed: $(git config core.hooksPath)"
