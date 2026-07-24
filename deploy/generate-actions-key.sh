#!/usr/bin/env bash
# Run ONCE, over SSH, as your normal (non-root) cPanel account user.
# Generates a dedicated SSH keypair that GitHub Actions will use to log
# into this account and run deploy/deploy.sh. Does not touch anything
# outside your own home directory — no root needed.

set -euo pipefail

SSH_DIR="$HOME/.ssh"
KEY_PATH="$SSH_DIR/github_actions_deploy"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

if [[ -f "$KEY_PATH" ]]; then
  echo "Key already exists at $KEY_PATH — remove it first if you want to regenerate." >&2
  exit 1
fi

ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "github-actions-deploy"
cat "${KEY_PATH}.pub" >> "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

cat <<EOF

======================================================================
Add these as GitHub repo secrets (Settings -> Secrets and variables ->
Actions -> New repository secret):

  DEPLOY_SSH_HOST = $(hostname -f 2>/dev/null || hostname)
  DEPLOY_SSH_PORT = 22   (confirm your actual SSH port)
  DEPLOY_SSH_USER = $(whoami)
  DEPLOY_SSH_KEY  = contents of ${KEY_PATH} (private key, printed below)

----------------------------------------------------------------------
$(cat "$KEY_PATH")
----------------------------------------------------------------------

Also add these as repo Variables (Actions -> Variables, not secret):

  APP_DIR       = full path to where you cloned the app (the Node.js
                  Selector "Application root"), e.g.
                  $HOME/domains/example.com/public_html/app
  NODEVENV_DIR  = path cPanel showed you when creating the Node.js app,
                  e.g. $HOME/nodevenv/domains/example.com/public_html/app/20
======================================================================
EOF
