const MARKER = '<!-- ci-report:';
const CI = 'Azure Static Web Apps CI/CD';

function seconds(job) {
  if (job.conclusion === 'skipped' || !job.started_at || !job.completed_at) return null;
  return Math.max(0, (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
}
function duration(value) {
  return value === null ? '—' : `${value.toFixed(1)} s`;
}
function cell(text) {
  return String(text).replace(/[\r\n|]/g, ' ').replace(/</g, '&lt;');
}
function timingTable(base, head) {
  const names = [...new Set([...base, ...head].map(j => j.name))].sort();
  return ['| Job | main | PR | Unterschied |', '|---|---:|---:|---:|', ...names.map(name => {
    const a = seconds(base.find(j => j.name === name) || {});
    const b = seconds(head.find(j => j.name === name) || {});
    const delta = a === null || b === null ? '—' : `${b >= a ? '+' : ''}${(b - a).toFixed(1)} s`;
    return `| ${cell(name)} | ${duration(a)} | ${duration(b)} | ${delta} |`;
  })].join('\n');
}
function logComment(run, logs) {
  const intro = `${MARKER}${run.workflow_id} -->\n### Fehlgeschlagene Actions: ${cell(run.name)}\n\n[Gesamter Lauf und vollständige Logs](${run.html_url}) · Versuch ${run.run_attempt}\n\n`;
  // Keep enough room per job even when a matrix has hundreds of failures.
  logs = logs.slice(0, 20);
  const limit = 60000;
  const available = Math.floor((limit - intro.length - 1000) / Math.max(1, logs.length));
  const sections = logs.map(({ name, text }) => {
    const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let content = escape(text);
    if (content.length > available - 300) {
      // Escape after truncation so neither an HTML entity nor the pre element is cut in half.
      const tail = text.slice(-Math.floor((available - 500) / 6));
      content = escape(text.slice(0, 100)) + '\n… gekürzt; Ende des Logs …\n' + escape(tail);
    }
    return '### ' + cell(name).slice(0, 100) + '\n\n<pre>' + content + '</pre>';
  });
  return intro + sections.join('\n\n') + '\n\nHöchstens 20 fehlgeschlagene Jobs; Logs können gekürzt sein. Vollständige Logs stehen im verlinkten Lauf.';
}
async function upsert(github, repo, pr, marker, body) {
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: pr });
  const old = comments.find(c => c.user?.type === 'Bot' && c.body?.startsWith(marker));
  if (old) await github.rest.issues.updateComment({ ...repo, comment_id: old.id, body });
  else await github.rest.issues.createComment({ ...repo, issue_number: pr, body });
}
async function report({ github, context, core }) {
  const run = context.payload.workflow_run;
  if (run.event !== 'pull_request') return;
  const repo = context.repo;
  // GitHub may omit pull_requests for forks. Resolve through the commit association, then
  // validate repository, branch and current head before writing anything.
  const associated = run.pull_requests?.length ? run.pull_requests : await github.paginate(
    github.rest.repos.listPullRequestsAssociatedWithCommit, { ...repo, commit_sha: run.head_sha });
  for (const ref of associated) {
    const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: ref.number });
    if (pr.state !== 'open' || pr.base.repo.full_name !== `${repo.owner}/${repo.repo}` ||
        pr.head.sha !== run.head_sha || pr.head.repo?.full_name !== run.head_repository?.full_name) continue;
    if (run.name === CI) {
      const { data: mainRuns } = await github.rest.actions.listWorkflowRuns({
        ...repo, workflow_id: run.workflow_id, branch: 'main', event: 'push', status: 'success', per_page: 100,
        created: `<=${run.created_at}`,
      });
      const base = mainRuns.workflow_runs[0];
      let body = '<!-- ci-timing -->\n### E2E budget: CI/CD-Zeitvergleich\n\n';
      if (base) {
        const jobs = async id => github.paginate(github.rest.actions.listJobsForWorkflowRun, { ...repo, run_id: id, filter: 'latest', per_page: 100 });
        body += `[main](${base.html_url}) (${base.head_sha.slice(0, 7)}) · [PR](${run.html_url}) (${run.head_sha.slice(0, 7)})\n\n`;
        body += timingTable(await jobs(base.id), await jobs(run.id));
        body += '\n\nGemessene Joblaufzeiten, ohne Wartezeit vor dem Job. — bedeutet fehlend oder übersprungen. Parallele Jobs sind einzeln aufgeführt. Auswahl der Tests und Cache-Treffer können sich unterscheiden. Vergleich mit dem letzten erfolgreichen main-Lauf vor diesem PR-Lauf.';
      } else body += 'Noch kein erfolgreicher CI/CD-Lauf auf main als Vergleich vorhanden.';
      await upsert(github, repo, pr.number, '<!-- ci-timing -->', body);
    }
    if (run.conclusion !== 'failure' && run.conclusion !== 'timed_out') continue;
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
      ...repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
    });
    const failed = jobs.filter(j => ['failure', 'timed_out'].includes(j.conclusion));
    const logs = [];
    for (const job of failed.slice(0, 20)) {
      try {
        const response = await github.rest.actions.downloadJobLogsForWorkflowRun({ ...repo, job_id: job.id });
        logs.push({ name: job.name, text: typeof response.data === 'string' ? response.data : Buffer.from(response.data).toString('utf8') });
      } catch (error) {
        core.warning(`Logs for job ${job.id} unavailable: ${error.status || 'unknown error'}`);
        logs.push({ name: job.name, text: 'Logs nicht verfügbar. Bitte den verlinkten Lauf öffnen.' });
      }
    }
    if (!logs.length) logs.push({ name: 'Workflow', text: 'Keine fehlgeschlagenen Job-Logs verfügbar. Bitte den verlinkten Lauf öffnen.' });
    await upsert(github, repo, pr.number, `${MARKER}${run.workflow_id} -->`, logComment(run, logs));
  }
}
module.exports = { report, timingTable, logComment, seconds };
