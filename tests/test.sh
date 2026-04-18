#!/bin/env bash

# the tests have a tendency to segfault randomly, so this script calls tests in smaller
# suites and retries on segfaults up to 3 times. this is mostly for CI stability, regular
# dev can just run `npm test` as usual.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

readarray -d '' -t TEST_FILES < <(
    find "$PROJECT_DIR/tests/comptoken" \
        -path "$PROJECT_DIR/tests/comptoken/utils" -prune -o \
        -path "$PROJECT_DIR/tests/comptoken/utils/*" -prune -o \
        -name "*.ts" -print0
)

MOCHA_PATH="$PROJECT_DIR/node_modules/mocha/bin/mocha.js"
if [ ! -f "$MOCHA_PATH" ]; then
    echo "Error: mocha not found at $MOCHA_PATH"
    exit 1
fi

TEST_CMD=(node --import tsx "$MOCHA_PATH" --require 'mocha-suppress-logs' --timeout 1000000)

for file in "${TEST_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "Warning: Test file $file not found, skipping."
        continue
    fi

    readarray -t SUITES < <("${TEST_CMD[@]}" --dry-run "$file" | head -n -4 | tail -n +4 | grep -v "^$" | grep -ve "^ *[✔-]")

    # if no suites found, just run the whole file
    if [ ${#SUITES[@]} -eq 0 ]; then
        SUITES=("")
    fi

    echo "Running tests in $file"
    for suite in "${SUITES[@]}"; do
        suite=$(echo "$suite" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        for _ in {1..3}; do
            RUST_LOG= "${TEST_CMD[@]}" "$file" --grep "$suite"
            exit_code=$?
            if [ $exit_code -eq 0 ]; then
                break
            fi
            # if failed b/c something other than segfault, don't retry
            if [ $exit_code -ne 139 ]; then
                echo "Tests failed in $file"
                exit 1
            fi
            echo "Test run in $file crashed with segfault, retrying..."
        done
    done
done