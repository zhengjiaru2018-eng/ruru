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
git lfs version >/dev/null
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

# Serialize writes and honor GitHub's cooldown before retrying rate-limited requests.
write_api() {
  local attempt delay retry_after remaining reset now
  for attempt in 0 1 2 3 4; do
    sleep 1
    if gh api --include "$@" > "$WORKDIR/api-response" 2> "$WORKDIR/api-error"; then
      return 0
    fi
    cat "$WORKDIR/api-error" >&2
    remaining="$(awk 'tolower($1) == "x-ratelimit-remaining:" {print $2+0; exit}' "$WORKDIR/api-response")"
    if ! grep -Eqi 'rate limit|HTTP 429' "$WORKDIR/api-error" && [[ "$remaining" != 0 ]]; then
      return 1
    fi
    if (( attempt == 4 )); then
      return 75
    fi

    delay=$((60 << attempt))
    retry_after="$(awk 'tolower($1) == "retry-after:" {print $2+0; exit}' "$WORKDIR/api-response")"
    if [[ "$retry_after" =~ ^[0-9]+$ ]] && (( retry_after > delay )); then
      delay="$retry_after"
    fi
    reset="$(awk 'tolower($1) == "x-ratelimit-reset:" {printf "%.0f", $2; exit}' "$WORKDIR/api-response")"
    now="$(date +%s)"
    if [[ "$remaining" == 0 && "$reset" =~ ^[0-9]+$ ]] && (( reset - now + 1 > delay )); then
      delay=$((reset - now + 1))
    fi
    echo "GitHub rate limit reached. Retrying the same request in ${delay}s."
    sleep "$delay"
  done
}

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
  source_url="https://github.com/$SOURCE_OWNER/$repo.git"
  destination_url="https://github.com/$DEST_OWNER/$repo.git"
  if ! env -u GIT_ASKPASS git -c credential.helper= clone --bare --quiet "$source_url" "$dir"; then
    printf '%s\tFAILED\tCould not clone source\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  # Enumerate Git refs and fetch LFS objects before creating a destination.
  if ! git -C "$dir" for-each-ref --format='%(objectname)%09%(refname)' refs/heads refs/tags \
      | LC_ALL=C sort > "$WORKDIR/source-refs" ||
      ! git -C "$dir" lfs ls-files --all > "$WORKDIR/lfs-files"; then
    printf '%s\tFAILED\tCould not inspect source refs or LFS pointers\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi
  if [[ -s "$WORKDIR/lfs-files" ]] &&
      ! env -u GIT_ASKPASS git -C "$dir" -c credential.helper= \
        -c lfs.url="$source_url/info/lfs" lfs fetch --all origin; then
    printf '%s\tFAILED\tCould not fetch source LFS objects\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  # GitHub rejects duplicate names, even if an existing private repo was hidden by the token.
  create_status=0
  write_api --method POST user/repos -f name="$repo" -F private=true \
    -f description="Mirror of https://github.com/$SOURCE_OWNER/$repo" || create_status=$?
  if (( create_status != 0 )); then
    if (( create_status == 75 )); then
      printf '%s\tFAILED\tGitHub rate limit persisted after retries\n' "$repo" >> "$report"
      ((failed+=1))
      aborted=1
      echo "::endgroup::"
      break
    fi
    if grep -Eq "HTTP (401|403)|Resource not accessible by personal access token" "$WORKDIR/api-error"; then
      echo "::error::Cannot create repositories: use a short-lived classic token with repo and workflow scopes, or a fine-grained token for all repositories on the destination account with Administration, Contents and Workflows read/write. Update the token and replace the Actions secret, then start a new workflow run."
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

  # Keep copied workflow files in Git history without executing them on import.
  if ! write_api --method PUT "repos/$DEST_OWNER/$repo/actions/permissions" -F enabled=false; then
    printf '%s\tFAILED\tPrivate repository created; could not disable Actions before import\n' "$repo" >> "$report"
    ((failed+=1))
    aborted=1
    echo "::endgroup::"
    break
  fi

  git -C "$dir" remote add destination "$destination_url"
  # Pin both LFS URLs so source configuration cannot redirect the destination token.
  if [[ -s "$WORKDIR/lfs-files" ]] &&
      ! git -C "$dir" -c lfs.url="$destination_url/info/lfs" \
        -c lfs.pushurl="$destination_url/info/lfs" lfs push --all destination; then
    printf '%s\tFAILED\tPrivate repository created; LFS upload failed\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  leases=()
  refspecs=()
  while IFS=$'\t' read -r object_id ref; do
    leases+=("--force-with-lease=$ref:")
    refspecs+=("$object_id:$ref")
  done < "$WORKDIR/source-refs"

  # Require each destination ref to be absent. An atomic push prevents partial ref updates.
  if (( ${#refspecs[@]} > 0 )) &&
      ! git -C "$dir" push --atomic "${leases[@]}" destination "${refspecs[@]}"; then
    printf '%s\tFAILED\tPrivate repository created; atomic ref push failed\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  if (( ${#refspecs[@]} > 0 )); then
    default_branch="$(git -C "$dir" symbolic-ref --short HEAD)"
    if [[ "$(gh api "repos/$DEST_OWNER/$repo" --jq .default_branch)" != "$default_branch" ]] &&
        ! write_api --method PATCH "repos/$DEST_OWNER/$repo" -f default_branch="$default_branch"; then
      printf '%s\tFAILED\tGit refs pushed; could not set source default branch\n' "$repo" >> "$report"
      ((failed+=1))
      echo "::endgroup::"
      continue
    fi
  fi

  if ! git -C "$dir" ls-remote --refs --heads --tags destination | LC_ALL=C sort > "$WORKDIR/destination-refs" ||
      ! cmp -s "$WORKDIR/source-refs" "$WORKDIR/destination-refs" ||
      [[ "$(gh api "repos/$DEST_OWNER/$repo" --jq .private)" != true ]]; then
    printf '%s\tFAILED\tCould not verify private visibility and matching branch and tag IDs\n' "$repo" >> "$report"
    ((failed+=1))
    echo "::endgroup::"
    continue
  fi

  printf '%s\tSUCCESS\tPrivate visibility, branches and tags verified\n' "$repo" >> "$report"
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
    echo "- **Stopped early:** review the GitHub API error above. Remaining projects were not attempted."
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
