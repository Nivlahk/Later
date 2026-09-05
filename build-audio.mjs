#!/usr/bin/env node
/* Build Sound Recordings/ from a local checkout of joshstephenson/PhoneticFlashCards.
   Two passes: the filename suffix carries the IPA symbol for the curated files;
   the archive/ files kept their original Wikipedia names, so those go through
   the matcher. */
import { readdirSync, statSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { match } from './match.mjs';
const require = createRequire(import.meta.url);
const E = require('./bridge-engine.js');

const SRC = process.argv[2];
const OUT = process.argv[3] || 'Sound Recordings';
if (!SRC){ console.error('usage: node build-audio.mjs <ipa_audio dir> [outdir]'); process.exit(1); }

const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
}).filter(p => /\.(mp3|ogg|oga|wav)$/i.test(p));

const known = new Set(Object.keys(E.SYMBOLS));
const bySym = {}, unmatched = [];

for (const p of walk(SRC)){
  const stem = basename(p).replace(/\.(ogg|oga|wav)?\.?(mp3|ogg|oga|wav)$/i, '');
  // pass 1: symbol appended to the filename
  let sym = stem.normalize('NFC').split('_').pop();
  if (!known.has(sym)){
    // pass 2: match the phonetic description
    sym = match(stem.replace(/_/g, ' ')) || null;
  }
  if (!sym){ unmatched.push(basename(p)); continue; }
  (bySym[sym] ||= []).push(p);
}

mkdirSync(OUT, { recursive: true });
const manifest = {};
let copied = 0;
for (const sym of Object.keys(bySym).sort()){
  const names = [];
  bySym[sym].slice(0, 3).forEach((p, i) => {
    const ext = (p.match(/\.[a-z0-9]+$/i) || ['.mp3'])[0].toLowerCase();
    const name = `${sym}-${i+1}${ext}`;
    copyFileSync(p, join(OUT, name));
    names.push(name); copied++;
  });
  manifest[sym] = names;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(join(OUT, 'CREDITS.md'), [
  '# Recording credits','',
  'Audio from the Wikipedia IPA charts, via joshstephenson/PhoneticFlashCards.',
  'Licensed CC BY-SA 3.0. Attribution is required and share-alike applies to',
  'derivatives — check this before shipping anything commercial.','',
  '- https://en.wikipedia.org/wiki/IPA_vowel_chart_with_audio',
  '- https://en.wikipedia.org/wiki/IPA_consonant_chart_with_audio','',
  `${Object.keys(manifest).length} symbols, ${copied} files.`,
].join('\n'));

console.log(`${Object.keys(manifest).length} symbols, ${copied} files -> ${OUT}/`);
const multi = Object.values(manifest).filter(v => v.length > 1).length;
console.log(`${multi} symbols have more than one recording`);
if (unmatched.length) console.log(`unmatched: ${unmatched.length}`);
