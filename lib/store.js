// JSON-file lead store. On Render, mount a disk at ./data so it survives restarts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DIR, 'leads.json');
let leads = [];

export function load() {
  fs.mkdirSync(DIR, { recursive: true });
  leads = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
  return leads;
}

export function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2));
  fs.renameSync(tmp, FILE);
}

export const all = () => leads;
export const get = (id) => leads.find((l) => l.id === id);
export const byPhone = (p) => leads.find((l) => normPhone(l.phone) === normPhone(p));

export function add(data) {
  const n = leads.reduce((m, l) => Math.max(m, parseInt(String(l.id).replace(/\D/g, '')) || 0), 0) + 1;
  const lead = {
    id: data.id || 'L' + String(n).padStart(3, '0'),
    firstName: '', lastName: '', phone: '', email: '', city: '', county: '',
    consent: false, demo: false, optedOut: false,
    status: 'new', score: 0, qual: {}, messages: [], hubspotId: null,
    createdAt: new Date().toISOString(),
    ...data,
  };
  leads.push(lead);
  save();
  return lead;
}

export function reset(list) { leads = list; save(); }

export function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? '+1' + d : d ? '+' + d : '';
}
