// Twilio SMS, SendGrid email, HubSpot CRM. Missing credentials → dry-run (logged only).
const env = process.env;

export const configured = () => ({
  anthropic: !!env.ANTHROPIC_API_KEY,
  twilio: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
  sendgrid: !!(env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL),
  hubspot: !!env.HUBSPOT_TOKEN,
});

export async function sendSms(to, body, { demo } = {}) {
  if (demo || !configured().twilio) { console.log(`[dry-run sms] → ${to}: ${body}`); return { dryRun: true }; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${d.message}`);
  return { sid: d.sid };
}

export async function sendEmail(to, subject, text, { demo } = {}) {
  if (demo || !configured().sendgrid) { console.log(`[dry-run email] → ${to}: ${subject} | ${text}`); return { dryRun: true }; }
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.SENDGRID_FROM_EMAIL, name: env.REP_NAME || env.COMPANY_NAME },
      subject,
      content: [{ type: 'text/plain', value: text + `\n\n— ${env.REP_NAME || ''}, ${env.COMPANY_NAME || ''}\nReply "unsubscribe" to stop hearing from us.` }],
    }),
  });
  if (!r.ok) throw new Error(`SendGrid ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { ok: true };
}

const HS_STATUS = { new: 'NEW', contacted: 'ATTEMPTED_TO_CONTACT', engaged: 'IN_PROGRESS', qualified: 'OPEN_DEAL', booked: 'OPEN_DEAL', disqualified: 'UNQUALIFIED', opted_out: 'UNQUALIFIED' };

async function hs(pathname, method = 'GET', body) {
  const r = await fetch('https://api.hubapi.com' + pathname, {
    method,
    headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${d.message || ''}`);
  return d;
}

// Upsert the contact and attach a qualification note.
export async function syncHubspot(lead) {
  if (lead.demo || !configured().hubspot) { console.log(`[dry-run hubspot] ${lead.id} status=${lead.status} score=${lead.score}`); return { dryRun: true }; }
  const properties = {
    firstname: lead.firstName, lastname: lead.lastName, email: lead.email || undefined,
    phone: lead.phone || undefined, city: lead.city || undefined, state: 'CA',
    hs_lead_status: HS_STATUS[lead.status] || 'NEW',
  };
  let id = lead.hubspotId;
  if (!id && lead.email) {
    const found = await hs('/crm/v3/objects/contacts/search', 'POST', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }], limit: 1 });
    id = found.results?.[0]?.id;
  }
  if (id) await hs(`/crm/v3/objects/contacts/${id}`, 'PATCH', { properties });
  else id = (await hs('/crm/v3/objects/contacts', 'POST', { properties })).id;

  const note = `Solar AI Agent — status: ${lead.status}, score: ${lead.score}/100\n` +
    Object.entries(lead.qual).filter(([, v]) => v).map(([k, v]) => `• ${k}: ${v}`).join('\n');
  await hs('/crm/v3/objects/notes', 'POST', {
    properties: { hs_note_body: note, hs_timestamp: new Date().toISOString() },
    associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
  });
  return { id };
}
