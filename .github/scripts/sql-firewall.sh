#!/usr/bin/env bash
# Lets this GitHub runner through the firewall of an Azure SQL server for one job.
#
# Usage: sql-firewall.sh open <server>
#        sql-firewall.sh close <server>
#        sql-firewall.sh retry <command> [args…]
#
# The firewall of the preview server lets in Azure only, but GitHub also runs hosted runners
# outside Azure (e.g. 3.42.157.0/24 in AWS). "open" adds a rule for the public IPv4 address of
# this runner, "close" removes it again (run it with `if: always()`). The rule is named after
# the run, its attempt and the job, so parallel jobs never remove each other's rule.
# "retry" runs a command and repeats it for up to five minutes while the server still refuses
# this address: Azure may take a few minutes to apply a new rule.
#
# Needs a logged-in Azure CLI (azure/login) whose identity may write the firewall rules of the
# server in the resource group website-astro (docs/azure-sql.md, "Datenbanken für PR-Previews").
set -euo pipefail

resource_group=website-astro
action="${1:?action (open|close|retry) missing}"
shift

rule_name() {
  echo "github-actions-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}-${GITHUB_JOB:?}"
}

case "$action" in
  open)
    server="${1:?server missing}"
    ip="$(curl -fsS --retry 3 --max-time 10 https://api.ipify.org)"
    if [[ ! "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
      echo "::error::Unexpected public IP address of the runner: $ip"
      exit 1
    fi
    az sql server firewall-rule create -g "$resource_group" -s "$server" -n "$(rule_name)" \
      --start-ip-address "$ip" --end-ip-address "$ip" --output none
    echo "Opened the firewall of $server for $ip ($(rule_name))."
    ;;
  close)
    server="${1:?server missing}"
    az sql server firewall-rule delete -g "$resource_group" -s "$server" -n "$(rule_name)" --output none
    echo "Closed the firewall rule $(rule_name) of $server."
    ;;
  retry)
    (($# > 0)) || { echo "::error::command missing"; exit 1; }
    log="$(mktemp)"
    for attempt in $(seq 1 10); do
      status=0
      "$@" 2>&1 | tee "$log" || status="${PIPESTATUS[0]}"
      ((status == 0)) && exit 0
      grep -q 'is not allowed to access the server' "$log" || exit "$status"
      ((attempt < 10)) || exit "$status"
      echo "The firewall rule is not active yet; trying again in 30 seconds (attempt $attempt of 10)."
      sleep 30
    done
    ;;
  *)
    echo "::error::Unknown action: $action"
    exit 1
    ;;
esac
