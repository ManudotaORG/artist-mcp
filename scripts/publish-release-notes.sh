#!/usr/bin/env bash
set -euo pipefail

release_tag="${1:-}"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required." >&2
  exit 1
fi

if [[ -n "$release_tag" ]]; then
  release_json="$(gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${release_tag}")"
else
  release_json="$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest")"
fi

release_title="$(jq -r '.name // .tag_name' <<<"$release_json")"
release_body="$(jq -r '.body // ""' <<<"$release_json")"
release_url="$(jq -r '.html_url' <<<"$release_json")"
messages="$(node scripts/format-release-notes.mjs "$release_title" "$release_body" "$release_url")"

while IFS= read -r message; do
  curl --fail --silent --show-error \
    --request POST \
    --url "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "disable_web_page_preview=true" \
    --data-urlencode "text=${message}" >/dev/null
done < <(jq -r '.[]' <<<"$messages")
