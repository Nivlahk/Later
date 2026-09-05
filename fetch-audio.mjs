#!/usr/bin/env node
/* ==========================================================================
   fetch-audio.mjs — pull phoneme recordings from Wikimedia Commons.

       node fetch-audio.mjs --dry          list what it would take, take nothing
       node fetch-audio.mjs                download into Sound Recordings/
       node fetch-audio.mjs --cat "Category:Foo"    add a category

   Walks Commons CATEGORIES (curated, unlike search) rather than guessing file
   names, matches each file to an IPA symbol, and writes:

       Sound Recordings/<ipa>-N.ogg     the audio, N per speaker found
       Sound Recordings/manifest.json   symbol -> [files], read by the app
       Sound Recordings/CREDITS.md      author + licence for every single file

   READ CREDITS.md BEFORE YOU SHIP. Most Commons audio is CC BY-SA: attribution
   is mandatory and share-alike constrains what you may do with derivatives.
   This script records the licence of everything it takes; it does not judge
   whether you may use it.

   Node 18+. No dependencies.
   ========================================================================== */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { match } from './match.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
const OUT = 'Sound Recordings';
const UA  = 'bridge-phonetics/1.0 (educational; contact: you@example.com)';

const args = process.argv.slice(2);
const dry  = args.includes('--dry');
const CATEGORIES = [
  'Category:Pronunciation of vowels',
  'Category:Pronunciation of consonants',
];
for (let i = 0; i < args.length; i++)
  if (args[i] === '--cat' && args[i+1]) CATEGORIES.push(args[i+1]);

async function api(params){
  const url = API + '?' + new URLSearchParams({ format:'json', formatversion:'2', ...params });
  const res = await fetch(url, { headers:{ 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ---- enumerate a category, following continuation ---------------------- */
async function categoryFiles(cat){
  const out = [];
  let cont = {};
  for (;;){
    const data = await api({
      action:'query', generator:'categorymembers',
      gcmtitle:cat, gcmtype:'file', gcmlimit:'500',
      prop:'imageinfo', iiprop:'url|mime|extmetadata', ...cont,
    });
    for (const p of (data?.query?.pages || [])){
      const ii = p.imageinfo?.[0];
      if (!ii || !/audio|ogg/.test(ii.mime || '')) continue;
      const m = ii.extmetadata || {};
      const strip = h => (h?.value || '').replace(/<[^>]*>/g, '').trim();
      out.push({
        title: p.title.replace(/^File:/, ''),
        url: ii.url,
        page: ii.descriptionurl,
        licence: strip(m.LicenseShortName) || 'unknown',
        author:  strip(m.Artist) || 'unknown',
      });
    }
    if (!data.continue) break;
    cont = data.continue;
  }
  return out;
}

/* ---- go ---------------------------------------------------------------- */
console.log(dry ? 'DRY RUN — nothing will be written\n' : '');
let all = [];
for (const cat of CATEGORIES){
  try {
    const f = await categoryFiles(cat);
    console.log(`${f.length.toString().padStart(4)} audio files in ${cat}`);
    if (!f.length) console.log('       (empty — check the category name exists on Commons)');
    all = all.concat(f);
  } catch (e){ console.error(`  ! ${cat}: ${e.message}`); }
}

// dedupe by URL, then bucket by matched symbol
const seen = new Set();
const bySym = {}, unmatched = [];
for (const f of all){
  if (seen.has(f.url)) continue;
  seen.add(f.url);
  const sym = match(f.title);
  if (!sym){ unmatched.push(f.title); continue; }
  (bySym[sym] ||= []).push(f);
}

const syms = Object.keys(bySym).sort();
console.log(`\n${syms.length} symbols matched, ${unmatched.length} files unmatched`);
const multi = syms.filter(s => bySym[s].length > 1);
console.log(`${multi.length} symbols have more than one recording (needed for the ear test)\n`);

if (!dry) await mkdir(OUT, { recursive: true });
const manifest = {}, credits = [];

for (const sym of syms){
  const files = bySym[sym];
  console.log(`  ${sym.padEnd(5)} ${files.length} file(s)`);
  const names = [];
  for (let i = 0; i < files.length; i++){
    const f = files[i];
    const ext = (f.url.match(/\.[a-z0-9]+$/i) || ['.ogg'])[0].toLowerCase();
    const name = `${sym}-${i+1}${ext}`;
    if (!dry){
      try { await access(`${OUT}/${name}`); }
      catch {
        try {
          const r = await fetch(f.url, { headers:{ 'User-Agent': UA } });
          if (!r.ok) throw new Error(String(r.status));
          await writeFile(`${OUT}/${name}`, Buffer.from(await r.arrayBuffer()));
          await new Promise(r2 => setTimeout(r2, 200));
        } catch (e){ console.log(`        failed ${f.title}: ${e.message}`); continue; }
      }
    }
    names.push(name);
    credits.push({ sym, name, ...f });
  }
  if (names.length) manifest[sym] = names;
}

if (!dry){
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
  await writeFile(`${OUT}/CREDITS.md`, [
    '# Recording credits', '',
    'From Wikimedia Commons. Attribution is required by the licences below.',
    'Check these against what you intend to do — share-alike in particular',
    'constrains derivatives and commercial use.', '',
    '| Sound | File | Licence | Author | Source |',
    '|---|---|---|---|---|',
    ...credits.map(c => `| ${c.sym} | ${c.name} | ${c.licence} | ${c.author} | [${c.title}](${c.page}) |`),
  ].join('\n'));
  console.log(`\nwrote ${credits.length} files, ${OUT}/manifest.json, ${OUT}/CREDITS.md`);
}

const lic = credits.reduce((a,c) => (a[c.licence] = (a[c.licence]||0)+1, a), {});
console.log('licences: ' + JSON.stringify(lic));
if (unmatched.length)
  console.log(`\nunmatched (first 15): ${unmatched.slice(0,15).join(', ')}`);
