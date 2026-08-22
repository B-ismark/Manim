#!/usr/bin/env bash
# Guard: LiveKit testing is FROZEN (quota near limit, 2026-06). See CLAUDE.md banner.
# Blocks any Bash/PowerShell command that *invokes* a test layer connecting to the
# CLOUD LiveKit project. Matches actual invocations (npm run …, npx playwright test,
# the load-test script) — not mere mentions in commit messages or echoes. test:unit /
# typecheck / lighthouse are LiveKit-free and stay allowed. Lift the freeze entirely
# by removing this hook.
#
# What the freeze protects is the cloud project's participant-minutes — so a run
# pointed at a `livekit-server --dev` on localhost is allowed (see below). Blocking
# those bought nothing and cost the ability to verify anything needing a real room.
input=$(cat)
cmd=$(printf '%s' "$input" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(((j.tool_input&&j.tool_input.command)||''))}catch(e){}})")

block() {
  echo "BLOCKED: LiveKit testing is frozen — monthly quota is near its limit (see CLAUDE.md banner). This command connects to the CLOUD LiveKit project and burns participant-minutes. Run instead: npm run typecheck, npm run test:unit, npm run lighthouse, or node audit/responsive-audit.mjs.

To test against a real room at zero quota cost, run a local server and point the
command at it inline, e.g.:
  livekit-server --dev
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \\
  LIVEKIT_URL=ws://127.0.0.1:7880 VITE_LIVEKIT_URL=ws://127.0.0.1:7880 \\
  npx playwright test <spec> --project=desktop

Only the owner may lift the freeze on the cloud project." >&2
  exit 2
}

# ── Localhost exemption ───────────────────────────────────────────────────────
# A run against a LiveKit on localhost cannot touch the cloud project's quota,
# which is the only thing this freeze protects.
#
# Two deliberate constraints keep this from becoming a loophole:
#  1. The URL must be set INLINE on the command, so "is this local?" is provable
#     from the command text itself rather than inherited from an environment this
#     hook cannot see.
#  2. EVERY LiveKit URL on the command must be local. A command mixing a local
#     VITE_LIVEKIT_URL (client) with a cloud LIVEKIT_URL (server) still blocks —
#     that combination WOULD bill the cloud project.
urls_total=$(printf '%s' "$cmd" | grep -oE '(VITE_)?LIVEKIT_URL=[^[:space:]]+' | wc -l)
urls_local=$(printf '%s' "$cmd" | grep -oE '(VITE_)?LIVEKIT_URL=(ws|wss|http|https)://(localhost|127\.0\.0\.1)(:[0-9]+)?([/[:space:]]|$)' | wc -l)
if [ "$urls_total" -gt 0 ] && [ "$urls_total" -eq "$urls_local" ]; then
  exit 0
fi

# Command position: start of line, or after a ; && || | separator, optionally
# preceded by inline VAR=value assignments. Anchoring here is what keeps the rules
# matching real INVOCATIONS rather than mentions — `git commit -m "npm test notes"`
# names the script inside a quoted argument and must not be blocked, which is what
# the header promises. (\b alone matched anywhere in the string, including there.)
AT_CMD='(^|[;&|][[:space:]]*)([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'

# npm test / npm run test (bare) — but NOT test:unit and other safe scripts.
printf '%s' "$cmd" | grep -Eq "${AT_CMD}npm[[:space:]]+(run[[:space:]]+)?test([[:space:]]|$|--)" && block
# Explicit LiveKit-backed npm scripts.
printf '%s' "$cmd" | grep -Eq "${AT_CMD}npm[[:space:]]+run[[:space:]]+(test:mobile(-sm)?|test:a11y|test:visual|test:stress|loadtest)\b" && block
# Direct Playwright invocation (any project hits LiveKit).
printf '%s' "$cmd" | grep -Eq '\bnpx[[:space:]]+playwright[[:space:]]+test\b' && block
printf '%s' "$cmd" | grep -Eq '(^|[;&|][[:space:]]*)playwright[[:space:]]+test\b' && block
# The load-test shell script.
printf '%s' "$cmd" | grep -Eq 'load-test\.sh' && block

exit 0
