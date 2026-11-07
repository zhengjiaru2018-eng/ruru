#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_OWNER="onesip"
DEST_OWNER="zhengjiaru2018-eng"
REPO_LIST="scripts/onesip-public-repos.txt"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

: "${GH_TOKEN:?ONESIP_MIGRATION_TOKEN is required as GH_TOKEN}"
command -v gh >/dev/null
command -v git >/dev/null
export GIT_TERMINAL_PROMPT=0

# Avoid putting access tokens in clone/push URLs, saved Git config, or command logs.
cat > "$WORKDIR/askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' "x-access-token" ;;
  *Password*) printf '%s\n' "$GH_TOKEN" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 700 "$WORKDIR/askpass"
export GIT_ASKPASS="$WORKDIR/askpass"

# Verify authenticated identity to avoid writing to the wrong GitHub account.
actual_login="$(gh api user --jq .login)"
if [[ "$actual_login" != "$DEST_OWNER" ]]; then
  echo "::error::Authenticated as $actual_login, expected $DEST_OWNER"
  exit 1
fi

success=0
skipped=0
failed=0
aborted=0
report="$WORKDIR/report.tsv"
printf 'Repository\tStatus\tDetails\n' > "$report"

while IFS= read -r repo || [[ -n "$repo" ]]; do
  [[ -z "$repo" || "$repo" == \#* ]] && continue
  # Prevent arbitrary API paths, shell injection and URL manipulation.
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    printf '%s\tFAILED\tInvalid repository name\n' "$repo" >> "$report"
    ((failed+=1))
    continue
  fi

  echo "::group::Migrating $SOURCE_OWNER/$repo"
  if gh api "repos/$DEST_OWNER/$repo" >/dev/null 2>&1; then
    echo "Skipping existing destination $DEST_OWNER/$repo"
    printf '%s\tSKIPPED\tDestination already exists\n' "$repo" >> "$report"
    ((skipped+=1))
    echo "::endgroup::"
    continue
  fi

  dir="$WORKDIR/${repo}.git"
  # Public sources require no old-account login.
  if ! git clone --bare --quiet "https://github.com/$SOURCE_OWNER/$repo.git" "$dir"; then
    printf '%s\tFAILED\tCould not clone source\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  # Never upload to a pre-existing repository; create as private for safety review.
  if ! gh api --method POST user/repos -f name="$repo" -F private=true -f description="Mirror of https://github.com/$SOURCE_OWNER/$repo" --silent 2>"$WORKDIR/create_error.txt"; then
    cat "$WORKDIR/create_error.txt" >&2
    if grep -Eq "HTTP (401|403)|Resource not accessible by personal access token" "$WORKDIR/create_error.txt"; then
      echo "::error::Cannot create repositories: token lacks Repository creation (write) or Administration (write). It also needs Contents (read/write) to push Git data. Update the token and replace the Actions secret, then start a new workflow run."
      printf '%s\tFAILED\tHTTP 401/403: insufficient GitHub Token permissions. Migration stopped early\n' "$repo" >> "$report"
      ((failed+=1))
      aborted=1
      echo "::endgroup::"
      break
    fi
    printf '%s\tFAILED\tCould not create destination (permission or quota)\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  git -C "$dir" remote add destination "https://github.com/$DEST_OWNER/$repo.git"
  if ! git -C "$dir" push --mirror destination; then
    printf '%s\tFAILED\tRepository created, Git refs need checking\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  if command -v git-lfs >/dev/null 2>&1 || git lfs version >/dev/null 2>&1; then
    if git -C "$dir" lfs ls-files --all | grep -q .; then
      if ! git -C "$dir" lfs fetch --all origin || ! git -C "$dir" lfs push --all destination; then
        printf '%s\tFAILED\tGit refs mirrored; LFS transfer needs attention\n' "$repo" >> "$report"
        ((failed+=1))
        echo "::endgroup::"
        continue
      fi
    fi
  fi

  printf '%s\tSUCCESS\tPrivate repository mirror created\n' "$repo" >> "$report"
  ((success+=1))
  echo "::endgroup::"
done < "$REPO_LIST"

{
  echo '## OneSip Git mirror migration'
  echo
  printf -- '- Source: `%s`\n' "$SOURCE_OWNER"
  printf -- '- Destination: `%s`\n' "$DEST_OWNER"
  echo "- Succeeded: **$success**"
  echo "- Skipped (already existed): **$skipped**"
  echo "- Needs attention: **$failed**"
  if (( aborted )); then
    echo "- **Stopped early:** token does not have permission to create new repositories. Remaining projects were not attempted."
  fi
  echo
  echo 'Repository | Status | Details'
  echo '--- | --- | ---'
  tail -n +2 "$report" | while IFS=$'\t' read -r repo status details; do
    printf '`%s` | %s | %s\n' "$repo" "$status" "$details"
  done
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if (( failed > 0 )); then
  echo "::error::$failed repositories need attention. Review the workflow summary."
  exit 1
fi
