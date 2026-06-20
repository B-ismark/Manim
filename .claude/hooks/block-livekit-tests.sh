#!/usr/bin/env bash
# Guard: LiveKit testing is FROZEN (quota near limit, 2026-06). See CLAUDE.md banner.
# Blocks any Bash/PowerShell command that *invokes* a test layer connecting to real
# LiveKit. Matches actual invocations (npm run …, npx playwright test, the load-test
# script) — not mere mentions in commit messages or echoes. test:unit / typecheck /
# lighthouse are LiveKit-free and stay allowed. Lift the freeze by removing this hook.
input=$(cat)
cmd=$(printf '%s' "$input" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(((j.tool_input&&j.tool_input.command)||''))}catch(e){}})")

block() {
  echo "BLOCKED: LiveKit testing is frozen — monthly quota is near its limit (see CLAUDE.md banner). This command connects to the real LiveKit project and burns participant-minutes. Run instead: npm run typecheck, npm run test:unit, npm run lighthouse, or node audit/responsive-audit.mjs. Only the owner may lift the freeze." >&2
  exit 2
}

# npm test / npm run test (bare) — but NOT test:unit and other safe scripts.
printf '%s' "$cmd" | grep -Eq '\bnpm[[:space:]]+(run[[:space:]]+)?test([[:space:]]|$|--)' && block
# Explicit LiveKit-backed npm scripts.
printf '%s' "$cmd" | grep -Eq '\bnpm[[:space:]]+run[[:space:]]+(test:mobile(-sm)?|test:a11y|test:visual|test:stress|loadtest)\b' && block
# Direct Playwright invocation (any project hits LiveKit).
printf '%s' "$cmd" | grep -Eq '\bnpx[[:space:]]+playwright[[:space:]]+test\b' && block
printf '%s' "$cmd" | grep -Eq '(^|[;&|][[:space:]]*)playwright[[:space:]]+test\b' && block
# The load-test shell script.
printf '%s' "$cmd" | grep -Eq 'load-test\.sh' && block

exit 0
