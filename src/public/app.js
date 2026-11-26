const scenarioList = document.getElementById('scenario-list');
const responsePanel = document.getElementById('response');
const announcement = document.getElementById('announcement');
const sourceList = document.getElementById('source-list');
const backToScenarios = document.getElementById('back-to-scenarios');
const resetDemo = document.getElementById('reset-demo');
const scenarioContext = document.getElementById('scenario-context');
const scenarioContextText = document.getElementById('scenario-context-text');
const catalogStatus = document.getElementById('catalog-status');
const idleOutcome = responsePanel.cloneNode(true);
const loadingMessage = catalogStatus.textContent;
let activeScenario;
let catalogLoading = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function describeError(error) {
  return error instanceof RequestError ? error.message : 'The demo could not display the response.';
}

function httpErrorMessage(status) {
  switch (status) {
    case 400: return 'The demo rejected this request.';
    case 401: return 'Sign-in is required to use the demo.';
    case 403: return 'Access to the demo was denied. Check that your account has access.';
    case 404: return 'This demo request is not available.';
    case 409: return 'This appointment draft is no longer valid.';
    case 429: return 'The demo is receiving too many requests. Wait briefly before trying again.';
    default: return status >= 500
      ? 'The demo service is temporarily unavailable.'
      : `The demo could not process the request (HTTP ${status}).`;
  }
}

function requireResponse(valid) {
  if (!valid) throw new RequestError('The demo returned an invalid response.');
}

async function request(path, data, signal) {
  let response;
  try {
    response = await fetch(path, {
      mode: 'same-origin',
      redirect: 'error',
      signal,
      ...(data && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RequestError('Could not connect to the demo. Check your connection.');
  }
  if (!response.ok) throw new RequestError(httpErrorMessage(response.status), response.status);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestError('The demo returned a non-JSON response.');

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RequestError(error instanceof SyntaxError
      ? 'The demo returned invalid JSON.'
      : 'Could not read the demo response. Check your connection.');
  }
  requireResponse(payload && typeof payload === 'object' && !Array.isArray(payload));
  return payload;
}

function hasText(record, ...fields) {
  return record != null && fields.every((field) => typeof record[field] === 'string' && record[field].trim() !== '');
}

function isList(value, isItem) {
  return Array.isArray(value) && value.every(isItem);
}

function isCitation(citation) {
  return hasText(citation, 'id', 'title', 'version', 'section') && citation.href === `/#${citation.id}`;
}

function isWorkshop(workshop) {
  return hasText(workshop, 'id', 'name', 'area');
}

function isSlot(slot) {
  return hasText(slot, 'id', 'label');
}

function matchesAppointment(result, selection) {
  const { draft } = result;
  return result.simulated === true && result.bookingSent === false &&
    hasText(draft, 'id') && isWorkshop(draft.workshop) && isSlot(draft.slot) &&
    draft.workshop.id === selection.workshopId && draft.slot.id === selection.slotId;
}

function showOutcome(kind, label, title, message) {
  const heading = element('h3', null, title);
  heading.tabIndex = -1;
  heading.setAttribute('aria-describedby', scenarioContext.id);
  responsePanel.dataset.outcome = kind;
  responsePanel.replaceChildren(element('span', 'outcome-badge', label), heading, element('p', null, message));
  return heading;
}

function canMoveFocus(trigger) {
  return document.activeElement === document.body || trigger.contains(document.activeElement);
}

function announceOutcome(heading, trigger, message = heading.textContent) {
  if (canMoveFocus(trigger)) {
    announcement.textContent = '';
    heading.focus();
  } else {
    announcement.textContent = message;
  }
}

function appointmentDetails({ workshop, slot }) {
  const details = element('dl', 'appointment-details');
  for (const [label, value] of [
    ['Fictional workshop', `${workshop.name} · ${workshop.area}`],
    ['Fictional time slot', slot.label],
  ]) {
    const row = element('div');
    row.append(element('dt', null, label), element('dd', null, value));
    details.append(row);
  }
  return details;
}

function showAppointment(result, workshops, signal) {
  const heading = showOutcome(result.kind, 'Simulated action', 'Prepare an appointment draft', result.message);
  const form = element('form', 'appointment-form');
  const draftArea = element('div', 'draft-area');
  const errorMessage = element('p', 'form-error');
  let busy = false;

  function field(label, id) {
    const wrapper = element('div', 'field');
    const caption = element('label', null, label);
    const select = element('select');
    caption.htmlFor = id;
    select.id = id;
    select.required = true;
    wrapper.append(caption, select);
    form.append(wrapper);
    return select;
  }

  function setChoices(select, placeholder, options, display) {
    const empty = new Option(placeholder, '', true, true);
    empty.disabled = true;
    select.replaceChildren(empty, ...options.map((option) => new Option(display(option), option.id)));
    select.value = '';
  }

  const workshop = field('Fictional workshop', 'workshop');
  const slot = field('Fictional time slot', 'slot');
  const preview = element('button', 'primary', 'Preview appointment draft');
  preview.type = 'submit';
  form.append(preview);
  responsePanel.append(form, draftArea, errorMessage);

  function updateFields() {
    workshop.disabled = busy;
    slot.disabled = busy || !workshop.value;
    preview.disabled = busy || !slot.value;
  }

  function setBusy(next) {
    busy = next;
    updateFields();
  }

  function clearDraft() {
    draftArea.replaceChildren();
    errorMessage.textContent = '';
    announcement.textContent = '';
  }

  function chooseSlots() {
    const selected = workshops.find(({ id }) => id === workshop.value);
    setChoices(slot, 'Choose a time slot', selected?.slots ?? [], ({ label }) => label);
    clearDraft();
    updateFields();
  }

  function recover(message, trigger, target = preview) {
    const returnFocus = canMoveFocus(trigger);
    clearDraft();
    setBusy(false);
    errorMessage.textContent = message;
    if (returnFocus) target.focus();
    announcement.textContent = message;
  }

  function showDraft(result, selection) {
    const card = element('section', 'draft-card');
    card.dataset.outcome = result.kind;
    const draftHeading = element('h4', null, 'Review appointment draft');
    draftHeading.tabIndex = -1;
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    const choice = element('label', 'confirm-choice');
    choice.append(checkbox, document.createTextNode('I confirm this fictional appointment draft.'));
    const confirm = element('button', 'primary', 'Confirm simulated appointment');
    const edit = element('button', 'secondary', 'Edit appointment details');
    const actions = element('div', 'draft-actions');
    const note = element('p', 'draft-note', 'Preview only. No booking was sent.');
    confirm.type = 'button';
    confirm.disabled = true;
    edit.type = 'button';
    checkbox.addEventListener('change', () => { confirm.disabled = busy || !checkbox.checked; });
    actions.append(confirm, edit);
    card.append(draftHeading, appointmentDetails(result.draft), note, choice, actions);
    draftArea.replaceChildren(card);

    edit.addEventListener('click', () => {
      if (busy || signal.aborted || !card.isConnected) return;
      clearDraft();
      workshop.focus();
      announcement.textContent = 'Draft cleared. Edit the workshop or time slot, then preview again.';
    });

    confirm.addEventListener('click', async () => {
      if (busy || signal.aborted || !card.isConnected || !checkbox.checked) return;
      setBusy(true);
      confirm.disabled = true;
      checkbox.disabled = true;
      edit.disabled = true;
      note.textContent = 'Confirming the simulated appointment…';
      announcement.textContent = 'Confirming the simulated appointment.';
      try {
        const confirmed = await request('/api/appointments/confirm', {
          ...selection, draftId: result.draft.id, confirm: checkbox.checked,
        }, signal);
        if (signal.aborted) return;
        requireResponse(confirmed.kind === 'appointment_confirmed' && matchesAppointment(confirmed, selection) &&
          confirmed.draft.id === result.draft.id && hasText(confirmed, 'message'));
        const confirmedHeading = showOutcome(
          confirmed.kind, 'Simulation complete', 'Fictional appointment confirmed', confirmed.message,
        );
        responsePanel.append(appointmentDetails(confirmed.draft));
        announceOutcome(confirmedHeading, card);
      } catch (error) {
        if (signal.aborted) return;
        const reason = error.status === 400 ? 'The demo rejected this appointment draft.' : describeError(error);
        const uncertainty = [400, 401, 403, 409, 429].includes(error.status)
          ? ''
          : 'The simulated confirmation could not be verified. ';
        recover(`${uncertainty}${reason} Preview the selected workshop and time slot again before confirming.`, card);
      }
    });
    return draftHeading;
  }

  workshop.addEventListener('change', chooseSlots);
  slot.addEventListener('change', () => { clearDraft(); updateFields(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || signal.aborted || !workshop.value || !slot.value) return;
    const selection = { workshopId: workshop.value, slotId: slot.value };
    clearDraft();
    setBusy(true);
    draftArea.replaceChildren(element('p', 'draft-note', 'Preparing the appointment draft…'));
    announcement.textContent = 'Preparing the appointment draft.';
    try {
      const result = await request('/api/appointments/preview', selection, signal);
      if (signal.aborted) return;
      requireResponse(result.kind === 'appointment_draft' && result.requiresConfirmation === true &&
        matchesAppointment(result, selection));
      setBusy(false);
      announceOutcome(showDraft(result, selection), form);
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 400) {
        recover('The demo rejected this workshop and time slot. Choose a different selection and preview again.', form, slot);
      } else {
        recover(`${describeError(error)} Preview the selected workshop and time slot again.`, form);
      }
    }
  });

  setChoices(workshop, 'Choose a workshop', workshops, ({ name }) => name);
  chooseSlots();
  return heading;
}

function showScenario(result, workshops, signal) {
  switch (result.kind) {
    case 'grounded_answer': {
      requireResponse(hasText(result, 'answer') && isList(result.citations, isCitation) && result.citations.length > 0);
      const heading = showOutcome(result.kind, 'Grounded answer', 'From the fictional source library', result.answer);
      const citations = element('ul', 'citations');
      citations.setAttribute('aria-label', 'Citations');
      for (const citation of result.citations) {
        const item = element('li', 'citation');
        const link = element('a');
        link.href = citation.href;
        link.append(
          element('span', 'citation-title', citation.title),
          element('span', 'citation-meta', `v${citation.version} · ${citation.section}`),
        );
        item.append(link);
        citations.append(item);
      }
      responsePanel.append(citations);
      return heading;
    }
    case 'appointment_selection':
      requireResponse(hasText(result, 'message'));
      return showAppointment(result, workshops, signal);
    case 'human_handoff': {
      requireResponse(hasText(result, 'message', 'safetyNote'));
      const heading = showOutcome(result.kind, 'Urgent · Simulation', 'Simulated human handoff', result.message);
      responsePanel.append(element('p', 'safety-note', result.safetyNote));
      return heading;
    }
    case 'insufficient_evidence':
      requireResponse(hasText(result, 'message'));
      return showOutcome(result.kind, 'Out of scope', 'Insufficient evidence', result.message);
    default:
      throw new RequestError('The demo returned an unknown outcome.');
  }
}

async function runScenario(scenario, button, workshops) {
  if (button.getAttribute('aria-pressed') === 'true' && responsePanel.dataset.outcome === 'loading') return;
  activeScenario?.abort();
  activeScenario = new AbortController();
  const { signal } = activeScenario;
  for (const candidate of scenarioList.querySelectorAll('button')) {
    candidate.setAttribute('aria-pressed', String(candidate === button));
  }
  backToScenarios.hidden = false;
  resetDemo.hidden = false;
  scenarioContextText.textContent = scenario.prompt;
  scenarioContext.hidden = false;
  showOutcome('loading', 'Running scenario', scenario.title, 'Preparing the response…');
  announcement.textContent = `Running ${scenario.title}.`;
  try {
    const result = await request('/api/scenario', { scenarioId: scenario.id }, signal);
    if (!signal.aborted) announceOutcome(showScenario(result, workshops, signal), button);
  } catch (error) {
    if (signal.aborted) return;
    const message = `${describeError(error)} Select a scenario to try again.`;
    const heading = showOutcome('error', 'Demo error', 'Scenario unavailable', message);
    announceOutcome(heading, button, `${heading.textContent}. ${message}`);
  }
}

resetDemo.addEventListener('click', () => {
  const selected = scenarioList.querySelector('[aria-pressed="true"]');
  if (!selected) return;
  activeScenario?.abort();
  activeScenario = undefined;
  selected.setAttribute('aria-pressed', 'false');
  responsePanel.dataset.outcome = idleOutcome.dataset.outcome;
  responsePanel.replaceChildren(...idleOutcome.cloneNode(true).childNodes);
  backToScenarios.hidden = true;
  resetDemo.hidden = true;
  scenarioContext.hidden = true;
  scenarioContextText.textContent = '';
  selected.focus();
  announcement.textContent = 'Demo reset. Choose a scenario to continue.';
});

function renderScenarioButtons(scenarios, workshops) {
  scenarioList.replaceChildren(...scenarios.map((scenario) => {
    const item = element('li');
    const button = element('button', 'scenario-button');
    button.type = 'button';
    button.dataset.scenario = scenario.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'response');
    const copy = element('span', 'scenario-copy');
    const tag = element('span', 'scenario-tag', scenario.tag);
    const title = element('span', 'scenario-title', scenario.title);
    const prompt = element('span', 'scenario-prompt', scenario.prompt);
    title.id = `scenario-${scenario.id}-title`;
    prompt.id = `scenario-${scenario.id}-prompt`;
    button.setAttribute('aria-labelledby', title.id);
    button.setAttribute('aria-describedby', prompt.id);
    const arrow = element('span', 'scenario-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    copy.append(tag, title, prompt);
    button.append(copy, arrow);
    button.addEventListener('click', () => runScenario(scenario, button, workshops));
    item.append(button);
    return item;
  }));
}

function renderSources(sources) {
  sourceList.replaceChildren(...sources.map((source) => {
    const article = element('article', 'source-card');
    article.id = source.id;
    article.tabIndex = -1;
    const title = element('h3', null, source.title);
    title.id = `${source.id}-title`;
    article.setAttribute('aria-labelledby', title.id);
    article.append(
      element('p', 'source-version', `Fictional source · v${source.version}`),
      title,
      element('p', 'source-section', source.section),
      element('blockquote', null, source.text),
    );
    return article;
  }));
}

const catalogActions = element('div', 'status-actions');
const retryCatalog = element('button', 'primary', 'Retry loading scenarios');
retryCatalog.type = 'button';
catalogActions.hidden = true;
catalogActions.append(retryCatalog);
catalogStatus.after(catalogActions);

async function loadCatalog(fromRetry = false) {
  if (catalogLoading) return;
  catalogLoading = true;
  catalogStatus.dataset.state = 'loading';
  catalogStatus.textContent = loadingMessage;
  catalogStatus.hidden = false;
  if (fromRetry) retryCatalog.setAttribute('aria-disabled', 'true');

  let focusTarget;
  try {
    const { scenarios, sources, workshops } = await request('/api/demo');
    requireResponse(isList(scenarios, (scenario) => hasText(scenario, 'id', 'tag', 'title', 'prompt')) &&
      scenarios.length > 0 && isList(sources, (source) => isCitation(source) && hasText(source, 'text')) &&
      isList(workshops, (workshop) => isWorkshop(workshop) && isList(workshop.slots, isSlot)));
    renderScenarioButtons(scenarios, workshops);
    renderSources(sources);
    if (fromRetry && canMoveFocus(retryCatalog)) {
      focusTarget = scenarioList.querySelector('button');
    } else if (document.activeElement === document.body) {
      const sharedSource = sources.find(({ href }) => href === `/${window.location.hash}`);
      if (sharedSource) focusTarget = document.getElementById(sharedSource.id);
    }
    catalogActions.hidden = true;
    catalogStatus.hidden = true;
    catalogStatus.textContent = '';
    delete catalogStatus.dataset.state;
  } catch (error) {
    scenarioList.replaceChildren();
    sourceList.replaceChildren();
    catalogStatus.dataset.state = 'error';
    catalogStatus.textContent = `Scenarios unavailable. ${describeError(error)}`;
    catalogActions.hidden = false;
    if (fromRetry && canMoveFocus(retryCatalog)) focusTarget = retryCatalog;
  } finally {
    catalogLoading = false;
    retryCatalog.removeAttribute('aria-disabled');
  }
  focusTarget?.focus();
}

retryCatalog.addEventListener('click', () => loadCatalog(true));
await loadCatalog();
