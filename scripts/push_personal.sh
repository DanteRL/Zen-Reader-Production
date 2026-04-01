#!/usr/bin/env bash
set -euo pipefail

echo "Working dir: $(pwd)"

# Show repository status
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository. Aborting." >&2
  exit 2
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $BRANCH"

STATUS=$(git status --porcelain)
if [ -n "$STATUS" ]; then
  echo "Uncommitted changes detected. Staging and committing all changes."
  git add -A
  COMMIT_MSG="fix(parseChapters): avoid mis-splitting English words in TXT parsing"
  # Use existing git config; if missing, set a fallback author to avoid commit failure
  if ! git config user.name >/dev/null; then
    git config user.name "personal"
  fi
  if ! git config user.email >/dev/null; then
    git config user.email "personal@local"
  fi
  git commit -m "$COMMIT_MSG" || true
else
  echo "No uncommitted changes."
fi

ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
if [ -z "$ORIGIN_URL" ]; then
  echo "No 'origin' remote configured. Please add a remote before pushing." >&2
  exit 3
fi

echo "Origin URL: $ORIGIN_URL"

# Convert HTTPS GitHub URL to SSH form if needed
REMOTE_SSH="$ORIGIN_URL"
if [[ "$ORIGIN_URL" == https://github.com/* ]]; then
  pathpart="${ORIGIN_URL#https://github.com/}"
  # strip leading slash if present
  pathpart="${pathpart#/}"
  REMOTE_SSH="git@github.com:$pathpart"
fi

echo "Target SSH URL: $REMOTE_SSH"

# If origin is https, switch it to SSH
if [[ "$ORIGIN_URL" == https://* ]]; then
  echo "Updating origin remote to SSH URL..."
  git remote set-url origin "$REMOTE_SSH"
fi

# Find candidate private keys in ~/.ssh (avoid bash-4+ only features for macOS)
SSH_DIR="$HOME/.ssh"
if [ ! -d "$SSH_DIR" ]; then
  echo "No ~/.ssh directory found. Cannot find SSH keys." >&2
  exit 4
fi

private_files=()
for filepath in "$SSH_DIR"/*; do
  if [ ! -f "$filepath" ]; then
    continue
  fi
  fname=$(basename "$filepath")
  case "$fname" in
    *.pub|known_hosts|config|authorized_keys) continue ;;
    *) private_files+=("$fname") ;;
  esac
done

if [ ${#private_files[@]} -eq 0 ]; then
  echo "No candidate private key files found in ~/.ssh." >&2
  exit 5
fi

selected=""
# preference order
for pat in personal github id_ed25519 id_rsa id_; do
  for f in "${private_files[@]}"; do
    if [[ "$f" == *"$pat"* ]]; then
      selected="$f"
      break 2
    fi
  done
done

if [ -z "$selected" ]; then
  selected="${private_files[0]}"
fi

KEYPATH="$SSH_DIR/$selected"

echo "Selected key: $KEYPATH"
if [ ! -f "$KEYPATH" ]; then
  echo "Selected key does not exist: $KEYPATH" >&2
  exit 6
fi

# Attempt push using chosen key (use IdentitiesOnly to force this key)
export GIT_SSH_COMMAND="ssh -i '$KEYPATH' -o IdentitiesOnly=yes"

echo "Running: git push -u origin $BRANCH"
if git push -u origin "$BRANCH"; then
  echo "Push succeeded."
  exit 0
else
  echo "Push failed. See output above. If the key is passphrase-protected, you may need an ssh-agent with the key loaded or provide the passphrase interactively." >&2
  exit 7
fi
