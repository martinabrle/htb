export const sources = [
  {
    id: 'warranty-guide-v1-0',
    title: 'Leap One Warranty Guide',
    version: '1.0',
    section: '§ 2 · Original charging cable',
    text: 'In this fictional warranty, the home charging cable supplied with a new Leap One is covered against manufacturing defects for 24 months from vehicle delivery. Accidental damage and normal wear are excluded.',
  },
  {
    id: 'maintenance-schedule-v1-1',
    title: 'Leap One Maintenance Schedule',
    version: '1.1',
    section: '§ 3 · Cabin filter',
    text: 'For the fictional Leap One, the cabin filter is due for replacement at 24 months or 30,000 km, whichever comes first.',
  },
].map((source) => ({ ...source, href: `/#${source.id}` }));

export const insufficientEvidence = {
  kind: 'insufficient_evidence',
  message: 'The fictional sources do not cover this request. No answer was invented and no action was taken.',
};

export const scenarios = [
  {
    id: 'warranty',
    tag: 'Grounded knowledge',
    title: 'Warranty coverage',
    prompt: 'Is the original home charging cable covered?',
    result: { kind: 'grounded_answer', sourceId: 'warranty-guide-v1-0' },
  },
  {
    id: 'maintenance',
    tag: 'Grounded knowledge',
    title: 'Maintenance schedule',
    prompt: 'When is the cabin filter due for replacement?',
    result: { kind: 'grounded_answer', sourceId: 'maintenance-schedule-v1-1' },
  },
  {
    id: 'appointment',
    tag: 'Simulated action',
    title: 'Workshop appointment',
    prompt: 'Help me prepare a fictional workshop visit.',
    result: {
      kind: 'appointment_selection',
      message: 'Choose a fictional workshop and time slot. Review the draft before confirming the simulation.',
    },
  },
  {
    id: 'urgent',
    tag: 'Safety handoff',
    title: 'Urgent safety concern',
    prompt: 'I see smoke while my car is charging.',
    result: {
      kind: 'human_handoff',
      urgent: true,
      simulated: true,
      advisorContacted: false,
      message: 'Immediate simulated handoff to a fictional human advisor. No diagnosis was made and no one was contacted.',
      safetyNote: 'If this is a real emergency, get to safety and contact your local emergency services.',
    },
  },
  {
    id: 'unsupported',
    tag: 'Out of scope',
    title: 'Unsupported guidance',
    prompt: 'What is the trade-in value of a Leap One?',
    result: insufficientEvidence,
  },
];

export const workshops = [
  {
    id: 'demo-north',
    name: 'Demo Workshop North',
    area: 'Fictional North District',
    slots: [
      { id: 'north-morning', label: '19 January 2027 · 09:30 CET' },
      { id: 'north-afternoon', label: '19 January 2027 · 14:00 CET' },
    ],
  },
  {
    id: 'demo-riverside',
    name: 'Demo Workshop Riverside',
    area: 'Fictional Riverside District',
    slots: [
      { id: 'riverside-morning', label: '20 January 2027 · 10:00 CET' },
      { id: 'riverside-afternoon', label: '20 January 2027 · 15:30 CET' },
    ],
  },
];
