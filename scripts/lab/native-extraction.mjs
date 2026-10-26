// Phase 5 native extraction regression (REG-DOC / REG-JOBS) against a disposable
// network:none lab. Usage: node scripts/lab/native-extraction.mjs --p04-complete <label>
// The lab profile flag is consumed by scripts/lab/native-lab.mjs. Requires the
// native gateway (node scripts/lab/server.mjs --p04-complete) to be running.
// Synthetic actors only; never reads .env or hosted credentials; writes its result
// JSON to the OS temp dir (skyline-native-extraction), never into the repo.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request,sql,service,password,verify} from './native-lab.mjs';

const label = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'run';
const identity = await verify();
const run = Date.now().toString();
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, result: 'PASS' }); } catch (e) { results.push({ name, result: 'FAIL', error: String(e.message).slice(0, 400) }); }
  console.log(results.at(-1));
}
const mode = (m) => writeFile('tmp/phase2-native/provider.json', JSON.stringify({ mode: m }));
const edge = async (fn, body, token, extra = {}) => {
  const r = await fetch('http://127.0.0.1:55431/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const stateOf = async (id) => (await sql(`select state from enrollment_document_extraction_jobs where id='${id}';`)).trim();
const waitState = async (id, want) => { for (let i = 0; i < 60; i++) { if ((await stateOf(id)) === want) return; await new Promise((r) => setTimeout(r, 250)); } throw Error(`job ${id} did not reach ${want}: ${await stateOf(id)}`); };

// Fixtures: one synthetic tenant/domain, agency, two agents in different agencies, one draft application.
const f = { tenant: randomUUID(), domain: `p5-${run}.localhost`, agency: randomUUID(), otherAgency: randomUUID(), app: randomUUID() };
await sql(`begin;insert into tenants(id,slug,name) values('${f.tenant}','p05-${run}','Phase 5 Synthetic RTO');insert into tenant_domains(hostname,tenant_id,verified_at,verification_evidence) values('${f.domain}','${f.tenant}',now(),'Phase 5 authorized synthetic fixture');insert into agencies(id,name,code,status) values('${f.agency}','Phase 5 Agency','p05-a-${run}','Active'),('${f.otherAgency}','Phase 5 Other Agency','p05-b-${run}','Active');insert into agency_tenants(agency_id,tenant_id) values('${f.agency}','${f.tenant}'),('${f.otherAgency}','${f.tenant}');commit;`);
async function actor(key, agency) {
  const email = `p05-${key}-${run}@example.test`;
  const created = await request('/auth/v1/admin/users', { method: 'POST', token: service, body: { email, password, email_confirm: true } });
  assert.equal(created.status, 200);
  const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  const profile = randomUUID();
  await sql(`begin;insert into portal_profiles(id,auth_user_id,full_name,email,status) values('${profile}','${created.data.id}','Synthetic ${key}','${email}','Active');insert into agency_memberships(user_id,agency_id,role,status) values('${profile}','${agency}','agent','Active');insert into agency_tenant_agents(tenant_id,agency_id,profile_id) values('${f.tenant}','${agency}','${profile}') on conflict do nothing;commit;`);
  return { token: login.data.access_token, profile };
}
const agent = await actor('agent', f.agency);
const other = await actor('other', f.otherAgency);
await sql(`insert into enrollment_applications(id,agency_id,assigned_agent_id,status,student_name,tenant_id) values('${f.app}','${f.agency}','${agent.profile}','draft','Synthetic student','${f.tenant}');`);
const headers = { 'x-tenant-domain': f.domain };
const rpc = (fn, body, token = agent.token) => request('/rest/v1/rpc/' + fn, { method: 'POST', token, headers, body });
const version = Number((await sql(`select draft_version from enrollment_applications where id='${f.app}';`)).trim());
await rpc('portal_review_draft_v2', { p_application_id: f.app, p_expected_version: version, p_values: { first_name: 'Manual protected' }, p_provenance: { first_name: 'Manual entry' }, p_confirmed: ['first_name'], p_resolutions: [{ field: 'first_name', state: 'corrected' }] });

async function upload(category) {
  const doc = randomUUID(), path = `${f.app}/${doc}.pdf`, pdf = `%PDF-1.4\nPhase 5 synthetic ${category} document.\n%%EOF`;
  assert.equal((await request('/storage/v1/object/enrollment-documents/' + path, { method: 'POST', token: agent.token, headers: { ...headers, 'Content-Type': 'application/pdf' }, body: pdf })).status, 200);
  const r = await request('/rest/v1/enrollment_application_documents', { method: 'POST', token: agent.token, headers, body: { id: doc, application_id: f.app, category, filename: doc + '.pdf', storage_path: path, bucket_name: 'enrollment-documents', mime_type: 'application/pdf', file_size: pdf.length } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { doc, path, pdf };
}

await mode('success');
const uploaded = {};
for (const category of ['Passport', 'Driving Licence', 'Visa', 'English Test', 'Academic']) {
  await check(`${category}: private upload, scoped Edge extraction, candidates, exact bytes, manual value protected`, async () => {
    const u = uploaded[category] = await upload(category);
    const queued = await edge('portal-document-extract', { documentId: u.doc }, agent.token, headers);
    assert.equal(queued.status, 200, JSON.stringify(queued));
    await waitState(queued.data.jobId, 'succeeded');
    assert.equal((await sql(`select metadata->'extraction'->'extracted'->>'first_name' from enrollment_application_documents where id='${u.doc}';`)).trim(), 'Native');
    assert.equal((await sql(`select metadata->'extraction'->'source'->>'parser' from enrollment_application_documents where id='${u.doc}';`)).trim(), 'document-extraction-v1');
    assert.equal((await request('/storage/v1/object/authenticated/enrollment-documents/' + u.path, { token: agent.token, headers })).data, u.pdf);
    assert.equal((await sql(`select data#>>'{values,first_name}' from enrollment_applications where id='${f.app}';`)).trim(), 'Manual protected');
  });
}
await check('unauthenticated enqueue is 401', async () => assert.equal((await edge('portal-document-extract', { documentId: uploaded.Passport.doc })).status, 401));
await check('other agency JWT is denied (403)', async () => assert.equal((await edge('portal-document-extract', { documentId: uploaded.Passport.doc }, other.token, headers)).status, 403));
await check('unsupported category is rejected without a job (422)', async () => {
  const u = await upload('Offer');
  assert.equal((await edge('portal-document-extract', { documentId: u.doc }, agent.token, headers)).status, 422);
  assert.equal((await sql(`select count(*) from enrollment_document_extraction_jobs where document_id='${u.doc}';`)).trim(), '0');
});
await check('provider failure queues a retry; later success recovers', async () => {
  await mode('failure');
  const u = await upload('Passport');
  const queued = await edge('portal-document-extract', { documentId: u.doc }, agent.token, headers);
  assert.equal(queued.status, 200, JSON.stringify(queued));
  for (let i = 0; i < 60 && (await sql(`select coalesce(last_error_code,'') from enrollment_document_extraction_jobs where id='${queued.data.jobId}';`)).trim() !== 'provider'; i++) await new Promise((r) => setTimeout(r, 250));
  assert.equal((await sql(`select state||':'||last_error_code from enrollment_document_extraction_jobs where id='${queued.data.jobId}';`)).trim(), 'queued:provider');
  await sql(`update enrollment_document_extraction_jobs set next_attempt_at=now() where id='${queued.data.jobId}';`);
  await mode('success');
  const w = await edge('portal-document-extract', { jobId: queued.data.jobId, tenantId: f.tenant }, undefined, { 'x-worker-secret': 'native-worker-only' }); assert.equal(w.data.processed, true, JSON.stringify(w) + ' ' + await sql(`select state,attempt_count,last_error_code,next_attempt_at<now() from enrollment_document_extraction_jobs where id='${queued.data.jobId}';`));
  assert.equal(await stateOf(queued.data.jobId), 'succeeded');
});
await check('in-flight cancellation fences a late provider completion', async () => {
  const u = await upload('Passport');
  const id = randomUUID();
  await sql(`insert into enrollment_document_extraction_jobs(id,document_id,application_id,tenant_id) values('${id}','${u.doc}','${f.app}','${f.tenant}');`);
  await mode('hold');
  const pending = edge('portal-document-extract', { jobId: id, tenantId: f.tenant }, undefined, { 'x-worker-secret': 'native-worker-only' });
  for (let i = 0; i < 60 && (await stateOf(id)) !== 'processing'; i++) await new Promise((r) => setTimeout(r, 250));
  await sql(`update enrollment_document_extraction_jobs set state='cancelled',lease_expires_at=null where id='${id}';`);
  await mode('success');
  const r = await pending;
  assert.equal(r.data.stale, true, JSON.stringify(r));
  assert.equal(await stateOf(id), 'cancelled');
  assert.equal((await sql(`select coalesce(metadata->'extraction'->'extracted'->>'first_name','') from enrollment_application_documents where id='${u.doc}';`)).trim(), '');
});

const outDir = join(tmpdir(), 'skyline-native-extraction');
await mkdir(outDir, { recursive: true });
const out = { label, run, identity, passed: results.filter((r) => r.result === 'PASS').length, failed: results.filter((r) => r.result === 'FAIL').length, provider: 'deterministic native fixture gateway; no live provider', results };
await writeFile(join(outDir, `native-extraction-${label}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(`native extraction ${label}: ${out.passed} PASS / ${out.failed} FAIL`);
process.exitCode = out.failed ? 1 : 0;
