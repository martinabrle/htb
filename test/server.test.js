import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from '../src/server.js';

const server = createServer();
let base;

async function listen(app) {
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${app.address().port}`;
}

function close(app) {
  return new Promise((resolve) => app.close(resolve));
}

before(async () => { base = await listen(server); });
after(() => close(server));

function post(path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function read(response, status = 200) {
  assert.equal(response.status, status);
  return response.json();
}

test('serves liveness and readiness directly, and remains live if packaged assets are absent', async (t) => {
  assert.deepEqual(await read(await fetch(`${base}/healthz`, { redirect: 'manual' })), { status: 'ok' });
  assert.deepEqual(await read(await fetch(`${base}/readyz`, { redirect: 'manual' })), { status: 'ready' });
  const incomplete = createServer({ publicRoot: new URL('./', import.meta.url) });
  const incompleteBase = await listen(incomplete);
  t.after(() => close(incomplete));
  assert.deepEqual(await read(await fetch(`${incompleteBase}/healthz`)), { status: 'ok' });
  assert.deepEqual(await read(await fetch(`${incompleteBase}/readyz`), 503), { status: 'not_ready' });
});

test('quotes the versioned source linked by each grounded answer', async () => {
  const { sources } = await read(await fetch(`${base}/api/demo`));
  for (const [scenarioId, sourceId] of [
    ['warranty', 'warranty-guide-v1-0'],
    ['maintenance', 'maintenance-schedule-v1-1'],
  ]) {
    const result = await read(await post('/api/scenario', { scenarioId }));
    assert.equal(result.kind, 'grounded_answer');
    assert.equal(result.citations.length, 1);
    const { id, href, title, version, section } = result.citations[0];
    assert.equal(id, sourceId);
    const source = sources.find((entry) => entry.id === id);
    assert.ok(source?.text);
    assert.equal(result.answer, source.text);
    assert.deepEqual({ title, version, section }, { title: source.title, version: source.version, section: source.section });
    assert.equal(href, `/#${id}`);
  }
});

test('routes urgency to a simulated handoff and answers unsupported requests with insufficient evidence', async () => {
  const urgent = await read(await post('/api/scenario', { scenarioId: 'urgent' }));
  assert.equal(urgent.kind, 'human_handoff');
  assert.equal(urgent.urgent, true);
  assert.equal(urgent.simulated, true);
  assert.equal(urgent.advisorContacted, false);
  assert.match(urgent.message, /no diagnosis/i);
  assert.equal(urgent.answer, undefined);
  assert.equal(urgent.draft, undefined);

  const unsupported = await read(await post('/api/scenario', { scenarioId: 'unsupported' }));
  assert.equal(unsupported.kind, 'insufficient_evidence');
  assert.equal(unsupported.answer, undefined);
  assert.equal(unsupported.citations, undefined);
  assert.equal(unsupported.draft, undefined);
});

test('requires an affirmative flag and a matching one-use preview to confirm a fictional appointment', async () => {
  const appointment = await read(await post('/api/scenario', { scenarioId: 'appointment' }));
  assert.equal(appointment.kind, 'appointment_selection');
  assert.equal(appointment.draft, undefined);

  const selection = { workshopId: 'demo-north', slotId: 'north-morning' };
  const preview = await read(await post('/api/appointments/preview', selection));
  assert.equal(preview.kind, 'appointment_draft');
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.bookingSent, false);
  assert.equal(preview.draft.workshop.id, selection.workshopId);
  assert.equal(preview.draft.slot.id, selection.slotId);

  const draft = { ...selection, draftId: preview.draft.id };
  await read(await post('/api/appointments/confirm', draft), 400);
  await read(await post('/api/appointments/confirm', { ...draft, confirm: 'true' }), 400);
  await read(await post('/api/appointments/confirm', { ...draft, draftId: 'not-a-preview', confirm: true }), 409);
  await read(await post('/api/appointments/confirm', { ...draft, slotId: 'north-afternoon', confirm: true }), 409);

  const confirmation = await read(await post('/api/appointments/confirm', { ...draft, confirm: true }));
  assert.equal(confirmation.kind, 'appointment_confirmed');
  assert.deepEqual(confirmation.draft, preview.draft);
  assert.equal(confirmation.simulated, true);
  assert.equal(confirmation.bookingSent, false);
  assert.match(confirmation.message, /no booking was sent/i);
  await read(await post('/api/appointments/confirm', { ...draft, confirm: true }), 409);
});

test('rejects unknown IDs, mismatched workshop slots and fields outside the fixture schema', async () => {
  await read(await post('/api/scenario', { scenarioId: 'not-a-scenario' }), 400);
  await read(await post('/api/scenario', { scenarioId: 'warranty', text: 'unexpected input' }), 400);
  await read(await post('/api/appointments/preview', { workshopId: 'unknown', slotId: 'north-morning' }), 400);
  await read(await post('/api/appointments/preview', { workshopId: 'demo-north', slotId: 'riverside-morning' }), 400);
  await read(await post('/api/appointments/confirm', {
    workshopId: 'demo-north', slotId: 'unknown', draftId: 'not-a-preview', confirm: true,
  }), 400);
});

test('rejects cross-origin API requests without adding CORS headers', async () => {
  const response = await post('/api/scenario', { scenarioId: 'warranty' }, { Origin: 'https://foreign.invalid' });
  assert.equal(response.headers.has('access-control-allow-origin'), false);
  await read(response, 403);
});
