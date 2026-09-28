// Seeds 61 fictional demo leads (555 numbers, example.com emails). Demo leads are never really contacted.
// Usage: npm run seed   (add --force to overwrite existing data)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';

const first = ['Maria','James','Linda','Robert','Patricia','Michael','Jennifer','David','Elizabeth','Carlos','Susan','Daniel','Karen','Jose','Nancy','Thomas','Lisa','Anthony','Sandra','Kevin','Ana','Brian','Michelle','Luis','Angela'];
const last = ['Garcia','Smith','Martinez','Johnson','Lopez','Brown','Hernandez','Davis','Gonzalez','Wilson','Rodriguez','Anderson','Perez','Taylor','Sanchez','Thomas','Ramirez','Moore','Torres','Jackson'];
const cities = ['Riverside','Corona','Moreno Valley','Temecula','Murrieta','Menifee','Hemet','Perris','Lake Elsinore','Eastvale','Jurupa Valley','Beaumont','Indio','Palm Desert','Norco'];

export function demoLeads(n = 61) {
  return Array.from({ length: n }, (_, i) => {
    const f = first[(i * 7) % first.length], l = last[(i * 11) % last.length];
    return {
      id: 'D' + String(i + 1).padStart(3, '0'),
      firstName: f, lastName: l,
      phone: `+1951555${String(1000 + i).slice(-4)}`,
      email: `${f}.${l}${i}@example.com`.toLowerCase(),
      city: cities[i % cities.length], county: 'Riverside',
      consent: true, demo: true, optedOut: false,
      status: 'new', score: 0, qual: {}, messages: [], hubspotId: null,
      createdAt: new Date().toISOString(),
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const existing = store.load();
  if (existing.length && !process.argv.includes('--force')) {
    console.log(`Data already has ${existing.length} leads. Use --force to overwrite.`);
  } else {
    store.reset(demoLeads());
    console.log('Seeded 61 demo leads.');
  }
}
