const scenarioList = document.getElementById('scenario-list');
const responsePanel = document.getElementById('response');
const announcement = document.getElementById('announcement');
const sourceList = document.getElementById('source-list');
let scenarioRun = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function request(path, data) {
  let response;
  let payload;
  try {
    response = await fetch(path, {
      mode: 'same-origin',
      redirect: 'error',
      ...(data && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    });
    payload = await response.json();
  } catch {
    throw new Error('The demo is unavailable. Try again.');
  }
  if (!response.ok) throw new Error(payload?.error?.message ?? 'The demo could not process the request.');
  return payload;
}

function showOutcome(kind, label, title, message) {
  const heading = element('h3', null, title);
  heading.tabIndex = -1;
  responsePanel.dataset.outcome = kind;
  responsePanel.replaceChildren(element('span', 'outcome-badge', label), heading, element('p', null, message));
  return heading;
}

function announceOutcome(heading, trigger) {
  if (document.activeElement === trigger || document.activeElement === document.body) {
    announcement.textContent = '';
    heading.focus();
  } else {
    announcement.textContent = heading.textContent;
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

function showAppointment(result, workshops, isCurrent) {
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

  function showError(error) {
    errorMessage.textContent = error.message;
    announcement.textContent = error.message;
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
    confirm.type = 'button';
    confirm.disabled = true;
    checkbox.addEventListener('change', () => { confirm.disabled = !checkbox.checked; });
    card.append(
      draftHeading,
      appointmentDetails(result.draft),
      element('p', 'draft-note', 'Preview only. No booking was sent.'),
      choice,
      confirm,
    );
    draftArea.replaceChildren(card);

    confirm.addEventListener('click', async () => {
      if (busy || !checkbox.checked) return;
      busy = true;
      updateFields();
      confirm.disabled = true;
      checkbox.disabled = true;
      announcement.textContent = 'Confirming the simulated appointment.';
      try {
        const confirmed = await request('/api/appointments/confirm', {
          ...selection, draftId: result.draft.id, confirm: checkbox.checked,
        });
        if (!isCurrent()) return;
        if (confirmed.kind !== 'appointment_confirmed') throw new Error('No simulation confirmation was returned.');
        const confirmedHeading = showOutcome(
          confirmed.kind, 'Simulation complete', 'Fictional appointment confirmed', confirmed.message,
        );
        responsePanel.append(appointmentDetails(confirmed.draft));
        announceOutcome(confirmedHeading, confirm);
      } catch (error) {
        if (!isCurrent()) return;
        draftArea.replaceChildren();
        showError(error);
        busy = false;
        updateFields();
        if (document.activeElement === document.body) preview.focus();
      }
    });
    return draftHeading;
  }

  workshop.addEventListener('change', chooseSlots);
  slot.addEventListener('change', () => { clearDraft(); updateFields(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !workshop.value || !slot.value) return;
    const selection = { workshopId: workshop.value, slotId: slot.value };
    clearDraft();
    busy = true;
    updateFields();
    announcement.textContent = 'Preparing the appointment draft.';
    try {
      const result = await request('/api/appointments/preview', selection);
      if (!isCurrent()) return;
      if (result.kind !== 'appointment_draft') throw new Error('No draft was returned. Try again.');
      announceOutcome(showDraft(result, selection), preview);
    } catch (error) {
      if (isCurrent()) showError(error);
    } finally {
      busy = false;
      if (isCurrent()) updateFields();
    }
  });

  setChoices(workshop, 'Choose a workshop', workshops, ({ name }) => name);
  chooseSlots();
  return heading;
}

function showScenario(result, workshops, isCurrent) {
  switch (result.kind) {
    case 'grounded_answer': {
      const heading = showOutcome(result.kind, 'Grounded answer', 'From the fictional source library', result.answer);
      const citations = element('ul', 'citations');
      citations.setAttribute('aria-label', 'Citations');
      for (const citation of result.citations) {
        const item = element('li', 'citation');
        const link = element('a', null, `${citation.title} · v${citation.version} · ${citation.section}`);
        link.href = citation.href;
        item.append(link);
        citations.append(item);
      }
      responsePanel.append(citations);
      return heading;
    }
    case 'appointment_selection':
      return showAppointment(result, workshops, isCurrent);
    case 'human_handoff': {
      const heading = showOutcome(result.kind, 'Urgent · Simulation', 'Simulated human handoff', result.message);
      responsePanel.append(element('p', 'safety-note', result.safetyNote));
      return heading;
    }
    case 'insufficient_evidence':
      return showOutcome(result.kind, 'Out of scope', 'Insufficient evidence', result.message);
    default:
      throw new Error('The demo returned an unknown outcome.');
  }
}

async function runScenario(scenario, button, workshops) {
  const run = ++scenarioRun;
  const isCurrent = () => run === scenarioRun;
  for (const candidate of scenarioList.querySelectorAll('button')) {
    candidate.setAttribute('aria-pressed', String(candidate === button));
  }
  document.getElementById('back-to-scenarios').hidden = false;
  showOutcome('loading', 'Running scenario', scenario.title, 'Preparing the response…');
  announcement.textContent = `Running ${scenario.title}.`;
  try {
    const result = await request('/api/scenario', { scenarioId: scenario.id });
    if (isCurrent()) announceOutcome(showScenario(result, workshops, isCurrent), button);
  } catch (error) {
    if (isCurrent()) announceOutcome(showOutcome('error', 'Demo error', 'Scenario unavailable', error.message), button);
  }
}

function renderScenarioButtons(scenarios, workshops) {
  for (const scenario of scenarios) {
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
    scenarioList.append(item);
  }
}

function renderSources(sources) {
  for (const source of sources) {
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
    sourceList.append(article);
  }
  const sharedSource = sources.find(({ href }) => href === `/${window.location.hash}`);
  if (sharedSource) document.getElementById(sharedSource.id).focus();
}

try {
  const { scenarios, sources, workshops } = await request('/api/demo');
  renderScenarioButtons(scenarios, workshops);
  renderSources(sources);
} catch {
  showOutcome('error', 'Demo error', 'Scenarios unavailable', 'Reload this page to try again.');
  announcement.textContent = 'Scenarios unavailable. Reload this page to try again.';
}
