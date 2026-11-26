import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { scenarios, sources, workshops } from './fixtures.js';

const staticRoutes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/brand.svg', ['brand.svg', 'image/svg+xml']],
]);
const sourceIndex = new Map(sources.map((source) => [source.id, source]));
const fixturesReady = scenarios.every(({ result }) => !result.sourceId || sourceIndex.has(result.sourceId));
const catalog = { scenarios: scenarios.map(({ result, ...scenario }) => scenario), sources, workshops };
const maxDrafts = 128;
const draftLifetime = 10 * 60 * 1000;
const maxBodyBytes = 1024;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

function json(response, status, data) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

function isCrossOrigin({ headers }) {
  const site = headers['sec-fetch-site'];
  if (site === 'same-origin') return false;
  if (site && site !== 'none') return true;
  const { origin, host } = headers;
  // TLS may terminate at the host before the request reaches Node.
  return origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`;
}

async function readJson(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ApiError(415, 'Use application/json.');
  let length = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBodyBytes) throw new ApiError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'A valid JSON object is required.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'A valid JSON object is required.');
  }
  return input;
}

function requireOnly(input, fields) {
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    throw new ApiError(400, 'Only the demo fixture fields are accepted.');
  }
}

function resolveScenario(input) {
  requireOnly(input, ['scenarioId']);
  const scenario = scenarios.find(({ id }) => id === input.scenarioId);
  if (!scenario) throw new ApiError(400, 'Choose a known demo scenario.');
  if (scenario.result.kind !== 'grounded_answer') return scenario.result;
  const source = sourceIndex.get(scenario.result.sourceId);
  if (!source) {
    console.error('The bundled source is missing:', scenario.result.sourceId);
    throw new ApiError(503, 'The cited demo source is unavailable.');
  }
  const { text, ...citation } = source;
  return { kind: 'grounded_answer', answer: text, citations: [citation] };
}

function findAppointment({ workshopId, slotId }) {
  const workshop = workshops.find(({ id }) => id === workshopId);
  const slot = workshop?.slots.find(({ id }) => id === slotId);
  if (!slot) throw new ApiError(400, 'Choose a known workshop and one of its fictional slots.');
  const { id, name, area } = workshop;
  return { workshop: { id, name, area }, slot };
}

export function createServer({ publicRoot = new URL('./public/', import.meta.url) } = {}) {
  const assets = Promise.all(Array.from(staticRoutes, async ([route, [file, type]]) => [
    route,
    { type, body: await readFile(new URL(file, publicRoot)) },
  ])).then((entries) => new Map(entries), (error) => {
    console.error('Could not load packaged demo assets:', error);
    return null;
  });
  const drafts = new Map();

  function previewAppointment(input) {
    requireOnly(input, ['workshopId', 'slotId']);
    const selection = findAppointment(input);
    const now = Date.now();
    // Keep only a bounded set of recent drafts; no draft leaves this process.
    for (const [id, { expiresAt }] of drafts) {
      if (expiresAt > now && drafts.size < maxDrafts) break;
      drafts.delete(id);
    }
    const draft = { id: randomUUID(), ...selection };
    drafts.set(draft.id, { draft, expiresAt: now + draftLifetime });
    return { kind: 'appointment_draft', draft, requiresConfirmation: true, simulated: true, bookingSent: false };
  }

  function confirmAppointment(input) {
    requireOnly(input, ['workshopId', 'slotId', 'draftId', 'confirm']);
    if (input.confirm !== true) throw new ApiError(400, 'Explicit confirmation is required.');
    const { workshop, slot } = findAppointment(input);
    if (typeof input.draftId !== 'string') throw new ApiError(400, 'A previewed draft ID is required.');
    const pending = drafts.get(input.draftId);
    if (!pending || pending.expiresAt <= Date.now() ||
        pending.draft.workshop.id !== workshop.id || pending.draft.slot.id !== slot.id) {
      throw new ApiError(409, 'Preview the selected workshop and slot again before confirming.');
    }
    drafts.delete(input.draftId);
    return {
      kind: 'appointment_confirmed',
      draft: pending.draft,
      simulated: true,
      bookingSent: false,
      message: 'No booking was sent. This confirmation only completes the simulation.',
    };
  }

  const actions = new Map([
    ['/api/scenario', resolveScenario],
    ['/api/appointments/preview', previewAppointment],
    ['/api/appointments/confirm', confirmAppointment],
  ]);

  return createHttpServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    // App Service checks the referrer on authenticated same-origin POSTs.
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const route = request.url;
    try {
      if (isRead && route === '/healthz') return json(response, 200, { status: 'ok' });
      if (isRead && route === '/readyz') {
        const ready = Boolean(fixturesReady && await assets);
        return json(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready' });
      }
      if (route.startsWith('/api/')) {
        if (isCrossOrigin(request)) throw new ApiError(403, 'The demo API is same-origin only.');
        if (isRead && route === '/api/demo') return json(response, 200, catalog);
        const action = actions.get(route);
        if (request.method === 'POST' && action) {
          return json(response, 200, action(await readJson(request)));
        }
      }
      if (isRead && staticRoutes.has(route)) {
        const asset = (await assets)?.get(route);
        if (!asset) throw new ApiError(503, 'The demo assets are unavailable.');
        return send(response, 200, asset.type, asset.body);
      }
      throw new ApiError(404, 'Route not found.');
    } catch (error) {
      if (response.destroyed) return;
      request.resume();
      const expected = error instanceof ApiError;
      if (!expected) console.error('Unexpected demo request failure:', error);
      json(response, expected ? error.status : 500, {
        error: { message: expected ? error.message : 'The demo could not process this request.' },
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, host, () => console.log(`Trabant Leap Agent listening on ${host}:${server.address().port}`));
}
