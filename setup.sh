#!/usr/bin/env bash
# Setup script for project dependencies and tooling
set -euo pipefail

# Install Rust using rustup if not already installed
if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing rustup (Rust toolchain)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "rustup already installed"
fi

# Install Solana CLI if not already installed
if ! command -v solana >/dev/null 2>&1; then
  echo "Installing Solana CLI"
  curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
  # The install script adds solana to the path via profile; source if exists
  if [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
else
  echo "Solana CLI already installed"
fi

# Install and activate pre-commit
if ! command -v pre-commit >/dev/null 2>&1; then
  echo "Installing pre-commit"
  pip install pre-commit
fi
pre-commit install

# Python dependencies
pip install -r test/requirements.txt

# Node dependencies
npm install --prefix test/compto-test-client

