// The agent brain: Claude qualifies the lead and writes the next message.
// With no ANTHROPIC_API_KEY it falls back to a scripted flow so the app is testable.

const env = process.env;

export const CRITERIA = [
  { key: 'homeowner',     q: 'Do you own your home?' },
  { key: 'propertyType',  q: 'Is it a single-family home?' },
  { key: 'utility',       q: 'Which utility are you with — SCE, IID, or another?' },
  { key: 'monthlyBill',   q: 'Roughly what is your average monthly electric bill?' },
  { key: 'roof',          q: 'How is your roof — in good shape, or needing work in the next few years?' },
  { key: 'shade',         q: 'Does your roof get good sun, or is it shaded by trees?' },
  { key: 'creditComfort', q: 'Our $0-down programs need a credit score around 650+. Is that comfortable for you?' },
  { key: 'decisionMakers',q: 'Would everyone on the title be able to join a quick 20-minute consultation?' },
  { key: 'appointment',   q: 'What day and time works best for that consultation?' },
];

function systemPrompt(lead) {
  return `You are ${env.REP_NAME || 'Marty'}, a friendly, concise solar advisor with ${env.COMPANY_NAME || 'our company'} in California (focus: Riverside County).
You are texting/emailing a homeowner who opted in to hear about $0-down solar through PPA or lease programs.

Goal: qualify them, then book a 20-minute consultation. Criteria: ${CRITERIA.map((c) => c.key).join(', ')}.
Rules:
- One question per message. SMS replies under 300 characters, warm and plain. No emojis beyond one occasionally.
- Never promise specific savings, rebates, or approval. Never pressure. Be honest that it's a sales consultation.
- Handle objections briefly (cost → $0 down, pay less than utility; renters/condos → politely disqualify; "not interested" → thank them and stop).
- If they ask to stop, set status "opted_out" and reply with a short confirmation only.
- Disqualify (status "disqualified") if renter, bill under ~$100, or roof unusable.
- When qualified and a time is agreed, set status "booked" and confirm the time.

Known so far: ${JSON.stringify(lead.qual)}
Lead: ${lead.firstName} ${lead.lastName}, ${lead.city || 'CA'}.

Respond ONLY with JSON: {"reply": string, "qual": {<criteria key>: string|null}, "status": "contacted"|"engaged"|"qualified"|"booked"|"disqualified"|"opted_out"}`;
}

export function score(qual = {}) {
  let s = 0;
  const yes = (v) => v && !/^(no|not|nope|rent)/i.test(String(v));
  if (yes(qual.homeowner)) s += 20;
  if (yes(qual.propertyType)) s += 5;
  if (qual.utility) s += 10;
  const bill = parseInt(String(qual.monthlyBill || '').replace(/[^\d]/g, '')) || 0;
  s += bill >= 250 ? 20 : bill >= 150 ? 15 : bill >= 100 ? 8 : 0;
  if (yes(qual.roof) && !/(bad|old|leak|replace|work)/i.test(qual.roof)) s += 10;
  if (qual.shade && !/(shade|tree|cover)/i.test(qual.shade) || /no shade|full sun|good sun/i.test(qual.shade || '')) s += 5;
  if (yes(qual.creditComfort)) s += 15;
  if (yes(qual.decisionMakers)) s += 10;
  if (qual.appointment) s += 5;
  return Math.min(100, s);
}

export async function think(lead, channel = 'sms') {
  if (!env.ANTHROPIC_API_KEY) return scripted(lead);

  const history = lead.messages.map((m) => ({ role: m.dir === 'out' ? 'assistant' : 'user', content: m.body }));
  // API needs the first message to be from the user.
  const messages = [{ role: 'user', content: `[System: start the ${channel} conversation now.]` }, ...history];
  if (messages.at(-1).role === 'assistant') messages.push({ role: 'user', content: '[System: no reply yet — send a short, polite follow-up.]' });
  // Merge consecutive same-role turns.
  const merged = messages.reduce((a, m) => (a.length && a.at(-1).role === m.role ? (a.at(-1).content += '\n' + m.content, a) : [...a, { ...m }]), []);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 600, system: systemPrompt(lead), messages: merged }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const text = (await r.json()).content?.map((c) => c.text || '').join('') || '';
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return { reply: text.trim(), qual: {}, status: lead.status };
  const out = JSON.parse(json[0]);
  return { reply: out.reply, qual: out.qual || {}, status: out.status || lead.status };
}

// Offline fallback: asks criteria in order and records answers verbatim.
function scripted(lead) {
  const lastIn = [...lead.messages].reverse().find((m) => m.dir === 'in');
  const qual = {};
  const pending = CRITERIA.find((c) => !lead.qual[c.key]);
  if (lastIn && pending && lead.messages.some((m) => m.dir === 'out')) qual[pending.key] = lastIn.body;
  const merged = { ...lead.qual, ...qual };
  if (/^(no|nope|renting|rent)/i.test(merged.homeowner || '')) return { reply: "Thanks for letting me know! Our programs are for homeowners, so I'll close this out. Have a great day.", qual, status: 'disqualified' };
  const next = CRITERIA.find((c) => !merged[c.key]);
  if (!lead.messages.some((m) => m.dir === 'out'))
    return { reply: `Hi ${lead.firstName}, it's ${env.REP_NAME || 'Marty'} with ${env.COMPANY_NAME || 'our solar team'}. You asked about $0-down solar — can I ask a couple quick questions? ${CRITERIA[0].q} (Reply STOP to opt out)`, qual, status: 'contacted' };
  if (!next) return { reply: `Perfect — you're booked for ${merged.appointment}. I'll send a reminder beforehand. Thanks, ${lead.firstName}!`, qual, status: 'booked' };
  return { reply: next.q, qual, status: next.key === 'appointment' ? 'qualified' : 'engaged' };
}
