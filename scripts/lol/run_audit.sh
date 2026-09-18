#!/usr/bin/env bash
# Run every step of the audit chain on its own and record which pass.
#   bash scripts/lol/run_audit.sh            -> audit_report.txt
# `npm run audit` stops at the first failure and cannot run on Windows at all (the chain uses
# POSIX `VAR=x cmd`, and npm there runs cmd.exe). This keeps going, so a broken check does not
# hide the forty after it.
export PYTHONIOENCODING=utf-8
cd "$(dirname "$0")/../.."
node -p "require('./package.json').scripts.audit.split(' && ').join('\n')" > .audit_steps.txt
: > audit_report.txt
pass=0; fail=0
while IFS= read -r step; do
  [ -z "$step" ] && continue
  start=$(date +%s)
  out=$(timeout 900 bash -c "$step" 2>&1); code=$?
  secs=$(( $(date +%s) - start ))
  if [ $code -eq 0 ]; then pass=$((pass+1)); echo "PASS ${secs}s  $step" >> audit_report.txt
  else fail=$((fail+1)); echo "FAIL ${secs}s  $step" >> audit_report.txt
    echo "$out" | grep -vE "^\s+at |^node:|^Node\.js" | tail -6 | sed 's/^/        /' | cut -c1-260 >> audit_report.txt
  fi
done < .audit_steps.txt
echo "---- $pass passed, $fail failed" >> audit_report.txt
rm -f .audit_steps.txt
