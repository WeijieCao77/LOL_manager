#!/usr/bin/env bash
# Rerun only the steps that failed in the last audit_report.txt.
export PYTHONIOENCODING=utf-8
cd "$(dirname "$0")/../.."
grep "^FAIL" audit_report.txt | sed -E 's/^FAIL [0-9]+s  //' > .failed_steps.txt
pass=0; fail=0; : > audit_rerun.txt
while IFS= read -r step; do
  out=$(timeout 900 bash -c "$step" 2>&1); code=$?
  if [ $code -eq 0 ]; then pass=$((pass+1)); echo "PASS  $step" >> audit_rerun.txt
  else fail=$((fail+1)); echo "FAIL  $step" >> audit_rerun.txt
    echo "$out" | grep -E "FAIL|rror|❌" | grep -vE "^\s+at " | head -4 | sed 's/^/        /' | cut -c1-240 >> audit_rerun.txt; fi
done < .failed_steps.txt
echo "---- rerun: $pass now pass, $fail still fail" >> audit_rerun.txt; rm -f .failed_steps.txt
