'use strict';
// GitHub Actions performs scraping; GAS owns storage and orchestration.
// Always invoked after the capture step, including when capture failed.
const required = [
  'TVER_ORCHESTRATOR_CALLBACK_URL',
  'TVER_ORCHESTRATOR_CALLBACK_TOKEN',
  'TVER_ORCHESTRATOR_BATCH_ID',
  'TVER_ORCHESTRATOR_STEP',
  'TVER_ORCHESTRATOR_WORKFLOW_FILE'
];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.warn('[WARN] Callback not configured: ' + missing.join(', '));
  process.exit(0); // GAS fallback polls GitHub Actions.
}
const payload = {
  token: process.env.TVER_ORCHESTRATOR_CALLBACK_TOKEN,
  batchId: process.env.TVER_ORCHESTRATOR_BATCH_ID,
  step: process.env.TVER_ORCHESTRATOR_STEP,
  workflowFile: process.env.TVER_ORCHESTRATOR_WORKFLOW_FILE,
  conclusion: process.env.TVER_ORCHESTRATOR_CONCLUSION === 'success' ? 'success' : 'error',
  runUrl: process.env.TVER_ORCHESTRATOR_RUN_URL || ''
};
async function notify() {
  const response = await fetch(process.env.TVER_ORCHESTRATOR_CALLBACK_URL, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(payload), redirect:'follow',
    signal:AbortSignal.timeout(20000)
  });
  const body = await response.text();
  let result; try {result = JSON.parse(body)} catch {throw new Error('GAS returned non-JSON response');}
  if (!response.ok || !result.ok) throw new Error('GAS callback rejected (HTTP '+response.status+')');
  console.log('[INFO] Orchestrator callback accepted', {batchId:payload.batchId,step:payload.step,ignored:!!result.ignored});
}
notify().catch(error => {console.error('[WARN] Orchestrator callback failed; GAS polling fallback will handle completion:',error.message); process.exitCode=0;});
