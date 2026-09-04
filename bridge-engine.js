/* ==========================================================================
   bridge-engine.js — feature graph + shortest-path solver, no dependencies.

   Every segment is a bundle of features. Two bundles are adjacent if exactly
   one feature differs by exactly one step, and each step has a cost. Finding
   the route from a sound a learner owns to one they don't is then a shortest
   path over that graph.

   Multi-source Dijkstra: seed with EVERY L1 sound at cost 0 and relax outward.
   The anchor falls out of the search rather than being picked in advance.

   Intermediate nodes are NOT required to be phonemes of any language. Sliding
   from /S/ toward /s`/ passes through positions no language uses
   contrastively, and that is exactly where the tongue has to go.

   Two modelling decisions worth knowing:
     - RETROFLEX IS NOT A PLACE. It is post-alveolar + apical articulator.
       That makes /S/ -> /s`/ one step (blade -> tip) while /S/ -> /s\/ is a
       place move. Different things to ask of a mouth.
     - LATERAL and LABIALISED are features, not manners, so l~4 and j~H stay
       one step apart.
   ========================================================================== */

(function (root) {
'use strict';

/* ---------- ordinal scales: adjacency is +/-1 along the list ------------- */

const PLACES = ['bilabial','labiodental','dental','alveolar','postalveolar',
                'alveolopalatal','palatal','velar','uvular','pharyngeal','glottal'];
const HEIGHTS = ['close','near-close','close-mid','mid','open-mid','near-open','open'];
const BACKNESS = ['front','central','back'];

const PLACE_IX  = Object.fromEntries(PLACES.map((p,i)=>[p,i]));
const HEIGHT_IX = Object.fromEntries(HEIGHTS.map((h,i)=>[h,i]));
const BACK_IX   = Object.fromEntries(BACKNESS.map((b,i)=>[b,i]));

/* ---------- non-ordinal features: explicit adjacency -------------------- */

const MANNER_EDGES = [
  ['plosive','affricate'],      // hold the release
  ['affricate','fricative'],    // drop the closure
  ['fricative','approximant'],  // open the channel until it stops hissing
  ['plosive','nasal'],          // drop the velum
  ['plosive','tap'],            // make the closure ballistic
  ['tap','trill'],              // let it vibrate
  ['tap','approximant'],        // stop touching
  ['plosive','fricative'],      // one step on [continuant]; priced separately
];
const ARTICULATOR_EDGES = [['apical','laminal'], ['laminal','dorsal']];
const PHONATION_EDGES = [
  ['plain','aspirated'], ['aspirated','breathy'], ['plain','breathy'],
  ['plain','tense'], ['plain','ejective'], ['plain','implosive'],
];

function adj(edges){
  const d = {};
  for (const [a,b] of edges){ (d[a] = d[a]||[]).push(b); (d[b] = d[b]||[]).push(a); }
  return d;
}
const MANNER_ADJ = adj(MANNER_EDGES);
const ARTICULATOR_ADJ = adj(ARTICULATOR_EDGES);
const PHONATION_ADJ = adj(PHONATION_EDGES);

/* ---------- step costs: the whole editorial model ----------------------- */

const COST = {
  place: 1.00, articulator: 1.00, manner: 1.20, voice: 0.80,
  phonation: 1.00, lateral: 1.20, labialised: 0.60,
  height: 0.70, backness: 0.90, round: 0.60, long: 0.40,
  nasalised: 0.90, rhotic: 1.10,
};
// skipping the affricate is a bigger jump than either half of it
const MANNER_STEP_COST = { 'fricative|plosive': 1.80 };  // key is sorted
function mannerCost(a,b){
  return MANNER_STEP_COST[[a,b].sort().join('|')] ?? COST.manner;
}
// a sound the learner produces but has never had to produce on purpose
const ALLOPHONE_PENALTY = 0.45;

/* ---------- segments ---------------------------------------------------- */

const PLACE_DEFAULT_ARTIC = {
  bilabial:'labial', labiodental:'labial', dental:'laminal', alveolar:'apical',
  postalveolar:'laminal', alveolopalatal:'laminal', palatal:'dorsal',
  velar:'dorsal', uvular:'dorsal', pharyngeal:'radical', glottal:'laryngeal',
};
const PLACE_ALLOWED_ARTIC = {
  bilabial:['labial'], labiodental:['labial'],
  dental:['apical','laminal'], alveolar:['apical','laminal'],
  postalveolar:['apical','laminal'],           // apical == retroflex
  alveolopalatal:['laminal'], palatal:['dorsal'], velar:['dorsal'],
  uvular:['dorsal'], pharyngeal:['radical'], glottal:['laryngeal'],
};

function seg(o){
  return Object.assign({
    kind:'C', place:'', articulator:'', manner:'', voiced:false,
    phonation:'plain', lateral:false, labialised:false,
    height:'', backness:'', round:false, long:false, nasalised:false, rhotic:false,
  }, o);
}
function key(s){
  return s.kind === 'C'
    ? `C|${s.place}|${s.articulator}|${s.manner}|${+s.voiced}|${s.phonation}|${+s.lateral}|${+s.labialised}`
    : `V|${s.height}|${s.backness}|${+s.round}|${+s.long}|${+s.nasalised}|${+s.rhotic}`;
}
function with_(s, patch){ return Object.assign({}, s, patch); }

function valid(s){
  if (s.kind === 'V') return true;
  const allowed = PLACE_ALLOWED_ARTIC[s.place];
  if (!allowed || !allowed.includes(s.articulator)) return false;
  if (s.lateral && !['approximant','fricative','tap'].includes(s.manner)) return false;
  if (s.lateral && !['dental','alveolar','postalveolar','alveolopalatal','palatal','velar'].includes(s.place)) return false;
  if (s.manner === 'nasal' && (!s.voiced || s.phonation !== 'plain' || s.place === 'glottal')) return false;
  if (s.manner === 'tap' || s.manner === 'trill'){
    if (!s.voiced || s.phonation !== 'plain') return false;
    if (!['bilabial','dental','alveolar','postalveolar','uvular'].includes(s.place)) return false;
  }
  if (['aspirated','breathy','tense','ejective'].includes(s.phonation) &&
      !['plosive','affricate','fricative'].includes(s.manner)) return false;
  if (s.phonation === 'implosive' && s.manner !== 'plosive') return false;
  if ((s.phonation === 'aspirated' || s.phonation === 'ejective') && s.voiced) return false;
  if (s.phonation === 'breathy' && !s.voiced) return false;
  if (s.manner === 'trill' && s.place === 'postalveolar') return false;
  if (s.place === 'glottal' && !['plosive','fricative','approximant'].includes(s.manner)) return false;
  if (s.place === 'pharyngeal' && !['fricative','approximant'].includes(s.manner)) return false;
  if (s.place === 'labiodental' && ['plosive','affricate'].includes(s.manner)) return false;
  if (s.manner === 'affricate' && ['glottal','pharyngeal','uvular'].includes(s.place)) return false;
  if (s.labialised && ['bilabial','labiodental'].includes(s.place)) return false;
  return true;
}

/** every single-feature neighbour: [segment, cost, [dim, from, to]] */
function neighbours(s){
  const out = [];
  const emit = (n, c, dim, f, t) => { if (valid(n)) out.push([n, c, [dim, f, t]]); };

  if (s.kind === 'C'){
    const i = PLACE_IX[s.place];
    for (const j of [i-1, i+1]){
      if (j < 0 || j >= PLACES.length) continue;
      const p = PLACES[j];
      const art = PLACE_ALLOWED_ARTIC[p].includes(s.articulator)
        ? s.articulator : PLACE_DEFAULT_ARTIC[p];
      emit(with_(s, {place:p, articulator:art}), COST.place, 'place', s.place, p);
    }
    for (const a of (ARTICULATOR_ADJ[s.articulator]||[]))
      emit(with_(s,{articulator:a}), COST.articulator, 'articulator', s.articulator, a);
    for (const m of (MANNER_ADJ[s.manner]||[]))
      emit(with_(s,{manner:m}), mannerCost(s.manner,m), 'manner', s.manner, m);
    emit(with_(s,{voiced:!s.voiced}), COST.voice, 'voice', s.voiced, !s.voiced);
    for (const p of (PHONATION_ADJ[s.phonation]||[]))
      emit(with_(s,{phonation:p}), COST.phonation, 'phonation', s.phonation, p);
    emit(with_(s,{lateral:!s.lateral}), COST.lateral, 'lateral', s.lateral, !s.lateral);
    emit(with_(s,{labialised:!s.labialised}), COST.labialised, 'labialised', s.labialised, !s.labialised);
  } else {
    let i = HEIGHT_IX[s.height];
    for (const j of [i-1,i+1]) if (j>=0 && j<HEIGHTS.length)
      emit(with_(s,{height:HEIGHTS[j]}), COST.height, 'height', s.height, HEIGHTS[j]);
    i = BACK_IX[s.backness];
    for (const j of [i-1,i+1]) if (j>=0 && j<BACKNESS.length)
      emit(with_(s,{backness:BACKNESS[j]}), COST.backness, 'backness', s.backness, BACKNESS[j]);
    for (const dim of ['round','long','nasalised','rhotic'])
      emit(with_(s,{[dim]:!s[dim]}), COST[dim], dim, s[dim], !s[dim]);
  }
  return out;
}

/* ======================================================================== */
/*  IPA table                                                               */
/* ======================================================================== */

const SYMBOLS = {}, NAMES = {}, BY_KEY = {};

function autoC(s){
  const b = [];
  if (s.phonation !== 'plain') b.push(s.phonation);
  b.push(s.voiced ? 'voiced' : 'voiceless');
  if (['dental','alveolar','postalveolar'].includes(s.place))
    b.push(s.articulator === 'apical' ? 'apical' : 'laminal');
  b.push(s.place);
  if (s.labialised) b.push('labialised');
  if (s.lateral) b.push('lateral');
  b.push(s.manner);
  return b.join(' ');
}
function autoV(s){
  const b = [];
  if (s.long) b.push('long');
  if (s.nasalised) b.push('nasalised');
  if (s.rhotic) b.push('r-coloured');
  b.push(s.height, s.backness, s.round ? 'rounded' : 'unrounded', 'vowel');
  return b.join(' ');
}
function reg(sym, s, name){
  if (!valid(s)) throw new Error('invalid bundle for ' + sym);
  SYMBOLS[sym] = s;
  NAMES[sym] = name || (s.kind === 'C' ? autoC(s) : autoV(s));
  const k = key(s);
  if (BY_KEY[k]) throw new Error(`bundle collision: ${sym} vs ${BY_KEY[k]}`);
  BY_KEY[k] = sym;
}
function C(sym, place, manner, voiced, o){
  o = o || {};
  reg(sym, seg({kind:'C', place, manner, voiced,
    articulator: o.artic || PLACE_DEFAULT_ARTIC[place],
    phonation: o.phon || 'plain', lateral: !!o.lateral, labialised: !!o.labial}), o.name);
}
function V(sym, height, backness, o){
  o = o || {};
  reg(sym, seg({kind:'V', height, backness, round:!!o.round,
    long:!!o.long, nasalised:!!o.nasal, rhotic:!!o.rhotic}), o.name);
}

/* plosives */
C('p','bilabial','plosive',false);            C('b','bilabial','plosive',true);
C('t','alveolar','plosive',false);            C('d','alveolar','plosive',true);
C('t̪','dental','plosive',false,{artic:'laminal'});
C('d̪','dental','plosive',true,{artic:'laminal'});
C('ʈ','postalveolar','plosive',false,{artic:'apical',name:'voiceless retroflex plosive'});
C('ɖ','postalveolar','plosive',true,{artic:'apical',name:'voiced retroflex plosive'});
C('c','palatal','plosive',false);             C('ɟ','palatal','plosive',true);
C('k','velar','plosive',false);               C('g','velar','plosive',true);
C('q','uvular','plosive',false);              C('ɢ','uvular','plosive',true);
C('ʔ','glottal','plosive',false);
/* aspirated */
C('pʰ','bilabial','plosive',false,{phon:'aspirated'});
C('tʰ','alveolar','plosive',false,{phon:'aspirated'});
C('t̪ʰ','dental','plosive',false,{artic:'laminal',phon:'aspirated'});
C('ʈʰ','postalveolar','plosive',false,{artic:'apical',phon:'aspirated',name:'aspirated voiceless retroflex plosive'});
C('kʰ','velar','plosive',false,{phon:'aspirated'});
/* breathy */
C('bʱ','bilabial','plosive',true,{phon:'breathy'});
C('d̪ʱ','dental','plosive',true,{artic:'laminal',phon:'breathy'});
C('ɖʱ','postalveolar','plosive',true,{artic:'apical',phon:'breathy',name:'breathy voiced retroflex plosive'});
C('gʱ','velar','plosive',true,{phon:'breathy'});
/* tense */
C('p͈','bilabial','plosive',false,{phon:'tense'});
C('t͈','alveolar','plosive',false,{phon:'tense'});
C('k͈','velar','plosive',false,{phon:'tense'});
/* affricates */
C('ts','alveolar','affricate',false);         C('dz','alveolar','affricate',true);
C('tsʰ','alveolar','affricate',false,{phon:'aspirated'});
C('ts͈','alveolar','affricate',false,{phon:'tense'});
C('tʃ','postalveolar','affricate',false,{artic:'laminal'});
C('dʒ','postalveolar','affricate',true,{artic:'laminal'});
C('tʃʰ','postalveolar','affricate',false,{artic:'laminal',phon:'aspirated'});
C('ʈʂ','postalveolar','affricate',false,{artic:'apical',name:'voiceless retroflex affricate'});
C('ʈʂʰ','postalveolar','affricate',false,{artic:'apical',phon:'aspirated',name:'aspirated voiceless retroflex affricate'});
C('tɕ','alveolopalatal','affricate',false);   C('dʑ','alveolopalatal','affricate',true);
C('tɕʰ','alveolopalatal','affricate',false,{phon:'aspirated'});
/* fricatives */
C('f','labiodental','fricative',false);       C('v','labiodental','fricative',true);
C('ɸ','bilabial','fricative',false);          C('β','bilabial','fricative',true);
C('θ','dental','fricative',false,{artic:'laminal'});
C('ð','dental','fricative',true,{artic:'laminal'});
C('s','alveolar','fricative',false,{artic:'laminal'});
C('z','alveolar','fricative',true,{artic:'laminal'});
C('s͈','alveolar','fricative',false,{artic:'laminal',phon:'tense'});
C('ʃ','postalveolar','fricative',false,{artic:'laminal'});
C('ʒ','postalveolar','fricative',true,{artic:'laminal'});
C('ʂ','postalveolar','fricative',false,{artic:'apical',name:'voiceless retroflex fricative'});
C('ʐ','postalveolar','fricative',true,{artic:'apical',name:'voiced retroflex fricative'});
C('ɕ','alveolopalatal','fricative',false);    C('ʑ','alveolopalatal','fricative',true);
C('ç','palatal','fricative',false);           C('ʝ','palatal','fricative',true);
C('x','velar','fricative',false);             C('ɣ','velar','fricative',true);
C('χ','uvular','fricative',false);            C('ʁ','uvular','fricative',true);
C('ħ','pharyngeal','fricative',false);        C('ʕ','pharyngeal','fricative',true);
C('h','glottal','fricative',false);           C('ɦ','glottal','fricative',true);
C('ɬ','alveolar','fricative',false,{artic:'laminal',lateral:true});
/* nasals */
C('m','bilabial','nasal',true);               C('ɱ','labiodental','nasal',true);
C('n','alveolar','nasal',true);
C('n̪','dental','nasal',true,{artic:'laminal'});
C('ɳ','postalveolar','nasal',true,{artic:'apical',name:'retroflex nasal'});
C('ɲ','palatal','nasal',true);                C('ŋ','velar','nasal',true);
C('ɴ','uvular','nasal',true);
/* approximants, taps, trills, laterals */
C('j','palatal','approximant',true);
C('ɥ','palatal','approximant',true,{labial:true,name:'labialised palatal approximant'});
C('w','velar','approximant',true,{labial:true,name:'labialised velar approximant'});
C('ɰ','velar','approximant',true);
/* NOTE: bunched /r\/ and curled /r\`/ are the same bundle here — both apical
   post-alveolar approximants, free variants for most speakers. One node. */
C('ɹ','postalveolar','approximant',true,{artic:'apical'});
C('ɾ','alveolar','tap',true);
C('ɽ','postalveolar','tap',true,{artic:'apical',name:'retroflex tap'});
C('r','alveolar','trill',true);               C('ʀ','uvular','trill',true);
C('ʙ','bilabial','trill',true);
C('l','alveolar','approximant',true,{lateral:true});
C('l̪','dental','approximant',true,{artic:'laminal',lateral:true});
C('ɭ','postalveolar','approximant',true,{artic:'apical',lateral:true,name:'retroflex lateral approximant'});
C('ʎ','palatal','approximant',true,{lateral:true});
C('ʟ','velar','approximant',true,{lateral:true});

/* vowels */
V('i','close','front');            V('y','close','front',{round:true});
V('ɨ','close','central');          V('ʉ','close','central',{round:true});
V('ɯ','close','back');             V('u','close','back',{round:true});
V('ɪ','near-close','front');       V('ʏ','near-close','front',{round:true});
V('ʊ','near-close','back',{round:true});
V('e','close-mid','front');        V('ø','close-mid','front',{round:true});
V('ɘ','close-mid','central');      V('ɵ','close-mid','central',{round:true});
V('ɤ','close-mid','back');         V('o','close-mid','back',{round:true});
V('ə','mid','central');
V('ɛ','open-mid','front');         V('œ','open-mid','front',{round:true});
V('ɜ','open-mid','central');       V('ʌ','open-mid','back');
V('ɔ','open-mid','back',{round:true});
V('æ','near-open','front');        V('ɐ','near-open','central');
V('a','open','front');             V('ɶ','open','front',{round:true});
V('ä','open','central');
V('ɑ','open','back');              V('ɒ','open','back',{round:true});

for (const [base, long] of [['i','iː'],['u','uː'],['e','eː'],['o','oː'],['a','aː'],
  ['ɛ','ɛː'],['ɔ','ɔː'],['ɑ','ɑː'],['y','yː'],['ø','øː'],['ɯ','ɯː'],['ɨ','ɨː'],['æ','æː']]){
  const s = SYMBOLS[base];
  V(long, s.height, s.backness, {round:s.round, long:true});
}
for (const [base, nas] of [['ɛ','ɛ̃'],['ɑ','ɑ̃'],['ɔ','ɔ̃'],['œ','œ̃'],['a','ã'],
  ['i','ĩ'],['u','ũ'],['o','õ'],['e','ẽ']]){
  const s = SYMBOLS[base];
  V(nas, s.height, s.backness, {round:s.round, nasal:true});
}
V('ɚ','mid','central',{rhotic:true});
V('ɝ','open-mid','central',{rhotic:true});

function label(s){
  return BY_KEY[key(s)] || '[' + (s.kind === 'C' ? autoC(s) : autoV(s)) + ']';
}

/* ======================================================================== */
/*  Languages                                                               */
/*  phonemes  — contrastive; free anchors.                                  */
/*  allophones — produced but never on purpose (English [4] in "butter").   */
/*               Usable at a small penalty; often the cheapest win there is.*/
/* ======================================================================== */

const LANGUAGES = {
  'english-ga': { name:'English (General American)',
    phonemes:['p','b','t','d','k','g','tʃ','dʒ','f','v','θ','ð','s','z','ʃ','ʒ','h',
      'm','n','ŋ','l','ɹ','j','w','i','ɪ','e','ɛ','æ','ə','ʌ','ɑ','ɔ','o','ʊ','u','ɚ','ɝ'],
    allophones:['ɾ','ʔ','pʰ','tʰ','kʰ'],
    notes:'Flapped [ɾ] in "butter", glottal stop in "uh-oh", aspirated stops word-initially.' },

  'english-rp': { name:'English (Southern British)',
    phonemes:['p','b','t','d','k','g','tʃ','dʒ','f','v','θ','ð','s','z','ʃ','ʒ','h',
      'm','n','ŋ','l','ɹ','j','w','iː','ɪ','e','ɛ','æ','ə','ʌ','ɑː','ɒ','ɔː','ʊ','uː','ɜ'],
    allophones:['ʔ','pʰ','tʰ','kʰ'] },

  'mandarin': { name:'Mandarin Chinese',
    phonemes:['p','pʰ','t','tʰ','k','kʰ','ts','tsʰ','ʈʂ','ʈʂʰ','tɕ','tɕʰ',
      'f','s','ʂ','ɕ','x','ʐ','m','n','ŋ','l','j','w','ɥ','i','y','u','ɤ','a','ɚ','ə'],
    allophones:[],
    notes:'Aspiration, not voicing, is the contrast in the stop series.' },

  'spanish': { name:'Spanish (Peninsular)',
    phonemes:['p','b','t̪','d̪','k','g','tʃ','f','θ','s','x',
      'm','n̪','ɲ','l̪','ʎ','ɾ','r','j','w','i','e','a','o','u'],
    allophones:['β','ð','ɣ','ŋ'],
    notes:'Voiced stops lenite between vowels — free anchors for /ð/ and /ɣ/.' },

  'french': { name:'French',
    phonemes:['p','b','t̪','d̪','k','g','f','v','s','z','ʃ','ʒ','ʁ',
      'm','n̪','ɲ','l̪','j','w','ɥ','i','y','u','e','ø','o','ɛ','œ','ɔ','a','ə',
      'ɛ̃','ɑ̃','ɔ̃','œ̃'], allophones:[] },

  'german': { name:'German (Standard)',
    phonemes:['p','b','t','d','k','g','ts','tʃ','f','v','s','z','ʃ','ç','x','h','ʁ',
      'm','n','ŋ','l','j','i','iː','ɪ','y','yː','ʏ','u','uː','ʊ','e','eː','ø','øː',
      'œ','o','oː','ɔ','ɛ','ɛː','a','aː','ə'],
    allophones:['ʔ','pʰ','tʰ','kʰ','ɐ'] },

  'japanese': { name:'Japanese (Tokyo)',
    phonemes:['p','b','t','d','k','g','ts','tɕ','dʑ','ɸ','s','z','ɕ','h','ç',
      'm','n','ɲ','ɴ','ɾ','j','w','i','e','a','o','ɯ','iː','eː','aː','oː'],
    allophones:['ɰ','ŋ','dz'],
    notes:'No /l/ ~ /ɹ/ contrast; the flap [ɾ] is the anchor for both.' },

  'korean': { name:'Korean (Seoul)',
    phonemes:['p','pʰ','p͈','t','tʰ','t͈','k','kʰ','k͈','ts','tsʰ','ts͈','s','s͈','h',
      'm','n','ŋ','l','ɾ','j','w','i','e','ɛ','a','o','u','ɯ','ʌ'],
    allophones:[],
    notes:'Three-way plain / aspirated / tense stop contrast; [l] and [ɾ] are one phoneme.' },

  'thai': { name:'Thai',
    phonemes:['p','pʰ','b','t','tʰ','d','k','kʰ','ʔ','tɕ','tɕʰ','f','s','h',
      'm','n','ŋ','l','ɾ','j','w','i','iː','e','eː','ɛ','ɛː','a','aː','ɔ','ɔː',
      'o','oː','u','uː','ɯ','ɯː','ɤ','ə'],
    allophones:[],
    notes:'Three-way voiced / plain / aspirated at bilabial and alveolar; length is contrastive.' },

  'russian': { name:'Russian',
    phonemes:['p','b','t̪','d̪','k','g','ts','tɕ','f','v','s','z','ʂ','ʐ','ɕ','x',
      'm','n̪','l̪','r','j','i','ɨ','e','a','o','u'],
    allophones:['ɲ','ʎ','ɣ','ʑ'],
    notes:'Palatalised counterparts of most consonants are omitted here for clarity.' },

  'polish': { name:'Polish',
    phonemes:['p','b','t̪','d̪','k','g','ts','dz','ʈʂ','tɕ','dʑ',
      'f','v','s','z','ʂ','ʐ','ɕ','ʑ','x','m','n̪','ɲ','l̪','r','j','w',
      'i','ɨ','ɛ','a','ɔ','u','ɛ̃','ɔ̃'],
    allophones:[],
    notes:'Has the full s / ʂ / ɕ three-way sibilant contrast — a strong L1 for Mandarin.' },

  'hindi': { name:'Hindi',
    phonemes:['p','pʰ','b','bʱ','t̪','t̪ʰ','d̪','d̪ʱ','ʈ','ʈʰ','ɖ','ɖʱ',
      'k','kʰ','g','gʱ','tʃ','tʃʰ','dʒ','s','ʃ','h','ɦ',
      'm','n','ɳ','ŋ','l','ɾ','ɽ','j','w',
      'i','iː','ɪ','u','uː','ʊ','e','o','ɛ','ɔ','ə','aː'],
    allophones:[],
    notes:'Four-way stop contrast and a true retroflex series — a strong L1 for Mandarin retroflexes.' },

  'arabic-msa': { name:'Arabic (Modern Standard)',
    phonemes:['b','t','d','k','g','q','ʔ','dʒ','f','θ','ð','s','z','ʃ','x','ɣ',
      'ħ','ʕ','h','m','n','l','r','j','w','i','iː','a','aː','u','uː'],
    allophones:[] },

  'portuguese-br': { name:'Portuguese (Brazilian)',
    phonemes:['p','b','t','d','k','g','tʃ','dʒ','f','v','s','z','ʃ','ʒ','x',
      'm','n','ɲ','l','ʎ','ɾ','j','w','i','e','ɛ','a','ɔ','o','u','ĩ','ẽ','ã','õ','ũ'],
    allophones:[] },

  'italian': { name:'Italian',
    phonemes:['p','b','t̪','d̪','k','g','ts','dz','tʃ','dʒ','f','v','s','z','ʃ',
      'm','n̪','ɲ','l̪','ʎ','r','j','w','i','e','ɛ','a','ɔ','o','u'],
    allophones:[] },

  'turkish': { name:'Turkish',
    phonemes:['p','b','t','d','k','g','tʃ','dʒ','f','v','s','z','ʃ','ʒ','h',
      'm','n','l','ɾ','j','i','y','ɯ','u','e','ø','a','o'],
    allophones:['c','ɟ','ɣ'] },

  'haitian-creole': { name:'Haitian Creole (experimental)',
    phonemes:['p','b','t','d','k','g','dʒ','f','v','s','z','ʃ','ʒ','h',
      'm','n','ŋ','l','ɣ','j','w',
      'i','e','ɛ','a','o','ɔ','u','ɛ̃','ɑ̃','ɔ̃'],
    allophones:[],
    notes:'Experimental. Seven oral vowels plus three nasal ones from French; '
        + 'no schwa, no dental fricatives, no /tʃ/. The r is a voiced velar fricative, '
        + 'not the English approximant, and vocalises toward [w] near back vowels.' },

  'vietnamese': { name:'Vietnamese (Northern)',
    phonemes:['p','b','t','tʰ','d','k','ʔ','f','v','s','z','x','ɣ','h',
      'm','n','ɲ','ŋ','l','j','w','i','e','ɛ','a','ɔ','o','u','ɯ','ɤ','ə'],
    allophones:[] },
};

/* ======================================================================== */
/*  Plain-language step descriptions                                        */
/* ======================================================================== */

const PLACE_WORDS = {
  bilabial:'the lips', labiodental:'lip against teeth', dental:'the teeth',
  alveolar:'the ridge behind the teeth', postalveolar:'just behind the ridge',
  alveolopalatal:'the front of the hard palate', palatal:'the hard palate',
  velar:'the soft palate', uvular:'the uvula', pharyngeal:'the throat',
  glottal:'the glottis',
};
const ARTIC_WORDS = {
  apical:'the tip of the tongue', laminal:'the blade of the tongue',
  dorsal:'the body of the tongue', labial:'the lips',
  radical:'the root of the tongue', laryngeal:'the larynx',
};
const MANNER_WORDS = {
  'plosive>affricate':'hold the release so it opens into a hiss instead of a pop',
  'affricate>plosive':'cut the hiss off the release — pure pop',
  'affricate>fricative':'drop the closure; start from the hiss with no stop',
  'fricative>affricate':'close first, then release into the hiss',
  'fricative>approximant':'open the channel until it stops hissing',
  'approximant>fricative':'narrow the channel until it hisses',
  'plosive>fricative':'stop closing all the way — leave a gap that hisses',
  'fricative>plosive':'close it off completely instead of leaving a gap',
  'plosive>nasal':'drop the velum and let the air out through the nose',
  'nasal>plosive':'seal the nose and let the pressure build',
  'plosive>tap':'make the closure ballistic — one quick strike, no hold',
  'tap>plosive':'hold the contact instead of striking through it',
  'tap>trill':'let the contact vibrate instead of striking once',
  'trill>tap':'one strike only; stop the vibration',
  'tap>approximant':'come close but stop touching',
  'approximant>tap':'let it touch, once, in passing',
};
const PHON_WORDS = {
  'plain>aspirated':'add a puff of air after the release',
  'aspirated>plain':'cut the puff of air — release straight into the vowel',
  'plain>breathy':'keep the voicing going and push extra breath through it',
  'breathy>plain':'cut the extra breath; clean voicing only',
  'aspirated>breathy':'voice it while keeping the breath going',
  'breathy>aspirated':'stop the voicing; keep the breath',
  'plain>tense':'stiffen the throat and hold the closure longer',
  'tense>plain':'relax the throat; shorten the closure',
  'plain>ejective':'close the glottis and squeeze the air out with it',
  'ejective>plain':'let the lungs, not the glottis, push the air',
  'plain>implosive':'pull the larynx down so air flows inward on release',
  'implosive>plain':'push outward instead of drawing inward',
};

function describe(change){
  const [dim, from, to] = change;
  switch (dim){
    case 'place':       return `move the constriction to ${PLACE_WORDS[to]}`;
    case 'articulator': return `hand the job from ${ARTIC_WORDS[from]} to ${ARTIC_WORDS[to]}`;
    case 'manner':      return MANNER_WORDS[`${from}>${to}`] || `change the manner from ${from} to ${to}`;
    case 'voice':       return to ? 'turn the voicing on' : 'turn the voicing off';
    case 'phonation':   return PHON_WORDS[`${from}>${to}`] || `change phonation from ${from} to ${to}`;
    case 'lateral':     return to ? 'let the air out over the sides of the tongue'
                                  : 'close off the sides; send the air down the centre';
    case 'labialised':  return to ? 'round and protrude the lips at the same time'
                                  : 'take the lip rounding off it';
    case 'height':      return `move the tongue to ${to}`;
    case 'backness':    return `move the tongue ${to}`;
    case 'round':       return to ? 'round the lips' : 'spread the lips';
    case 'long':        return to ? 'hold it longer' : 'cut it short';
    case 'nasalised':   return to ? 'drop the velum — let the vowel resonate in the nose'
                                  : 'seal the nose; keep it oral';
    case 'rhotic':      return to ? 'bunch or curl the tongue to r-colour it'
                                  : 'drop the r-colouring';
    default:            return `${dim}: ${from} → ${to}`;
  }
}

/* ======================================================================== */
/*  What KIND of change is this?                                            */
/*  Every step already knows its dimension; a bridge is tagged with the     */
/*  set of dimensions it touches, in a fixed order so the label is stable.  */
/* ======================================================================== */

const DIM_ORDER = ['place','articulator','manner','voice','phonation','lateral',
                   'labialised','height','backness','round','long','nasalised','rhotic'];

const DIM_LABEL = {
  place:'Place', articulator:'Articulator', manner:'Manner', voice:'Voicing',
  phonation:'Phonation', lateral:'Laterality', labialised:'Rounding',
  height:'Height', backness:'Backness', round:'Rounding', long:'Length',
  nasalised:'Nasality', rhotic:'R-colouring',
};

// one line on what that kind of change actually asks of the learner
const DIM_GLOSS = {
  place:'same gesture, different spot along the roof of the mouth',
  articulator:'same spot, different part of the tongue doing the work',
  manner:'same spot, different kind of obstruction',
  voice:'same gesture, vocal folds on or off',
  phonation:'same gesture, different behaviour at the larynx',
  lateral:'same contact, air rerouted over the sides of the tongue',
  labialised:'same tongue position, lips added or removed',
  height:'jaw and tongue body raised or lowered',
  backness:'tongue body forward or back',
  round:'lips rounded or spread',
  long:'same vowel, held longer or shorter',
  nasalised:'same vowel, velum opened to the nose',
  rhotic:'same vowel, tongue bunched or curled',
};

/** the ordered, de-duplicated dimensions a path touches */
function kindsOf(steps){
  const seen = new Set(steps.map(s => s.dim));
  return DIM_ORDER.filter(d => seen.has(d));
}


/* ========================================================================
   SELF-CHECKS — physical tests the learner can verify without judging sound.

   The point of these is that they DON'T route through the ear. A learner who
   cannot yet hear a contrast can still feel whether their larynx is buzzing or
   whether a paper strip moved. That is what makes production-before-perception
   safe: the objective check catches a wrong articulation before the learner
   starts training their ear against their own mistake.

   Each check is chosen from the feature that actually changed, so a compound
   bridge gets one check per changed feature.

   Some features have NO check I'd trust. Those are returned with
   reliable:false and say so plainly rather than inventing a test.
   ======================================================================== */

const MANNER_CHECK = {
  plosive:     ['Try to hold it', 'You should not be able to. There is a silent moment of complete closure, then a pop. If you can hiss continuously, you have not sealed it off.'],
  fricative:   ['Try to hold it', 'You should be able to hiss steadily for five seconds without the sound changing. If it stops dead or pops, you are closing all the way.'],
  affricate:   ['Listen for two parts', 'Say it very slowly. There should be a complete stop first, then a hiss out of the release — one gesture, two phases. A pure hiss means you skipped the closure.'],
  approximant: ['Hold it and listen for friction', 'You should be able to sustain it with no hiss at all. If it hisses, the channel is too narrow.'],
  tap:         ['Try to hold it', 'You should not be able to. It is one quick strike — the tongue passes through the contact rather than resting on it.'],
  trill:       ['Hold it for two seconds', 'You should feel the tongue flapping repeatedly on its own. If you are moving it deliberately, that is a series of taps, not a trill.'],
  nasal:       ['Pinch your nose', 'The sound should stop completely. If it keeps going, the air is escaping through your mouth and it is not nasal.'],
};

function checkFor(step){
  const [dim, from, to] = step;

  switch (dim){
    case 'voice':
      return to
        ? { title:'Feel for the buzz',
            how:'Put two fingers on the front of your throat and say it, drawn out.',
            pass:'Buzzing the whole time.' }
        : { title:'Feel for silence',
            how:'Two fingers on the front of your throat, say it drawn out.',
            pass:'No buzz at all — just breath. If it hums, the voicing is still on.' };

    case 'phonation':
      if (to === 'aspirated')
        return { title:'The paper test',
                 how:'Hold a strip of paper a few centimetres from your lips and say it.',
                 pass:'The paper kicks visibly on the release.' };
      if (from === 'aspirated' && to === 'plain')
        return { title:'The paper test, inverted',
                 how:'Paper strip at your lips, say it.',
                 pass:'The paper barely moves. English speakers leak aspiration here without noticing.' };
      if (to === 'breathy')
        return { title:'Buzz and breath together',
                 how:'Fingers on your throat, other hand palm-up in front of your mouth.',
                 pass:'Buzzing at the throat AND warm air on your palm, at the same time. Either one alone is wrong.' };
      if (to === 'ejective')
        return { title:'Hold your breath and try it',
                 how:'Take a breath, hold it, then produce the sound without letting the held breath go.',
                 pass:'It still works — the air comes from your larynx, not your lungs.' };
      if (to === 'implosive')
        return { title:'Feel the direction',
                 how:'Fingers on your throat; produce it slowly.',
                 pass:'Your larynx drops and air moves inward on release, not outward.' };
      if (to === 'tense')
        return { title:'No reliable self-check', reliable:false,
                 how:'Korean tense consonants involve stiffened vocal folds and a longer closure.',
                 pass:'There is no physical test for this I would trust. Get a speaker to check you.' };
      return null;

    case 'manner': {
      const m = MANNER_CHECK[to];
      return m ? { title:m[0], how:'Produce the target sound on its own.', pass:m[1] } : null;
    }

    case 'nasalised':
      return to
        ? { title:'Pinch your nose',
            how:'Say the vowel, then pinch your nostrils shut halfway through.',
            pass:'The sound changes noticeably — air was going through your nose.' }
        : { title:'Pinch your nose',
            how:'Say the vowel, then pinch your nostrils shut halfway through.',
            pass:'Nothing changes. If it does, you are nasalising a vowel that should be oral.' };

    case 'lateral':
      return to
        ? { title:'The inhale test',
            how:'Hold the tongue position and breathe IN sharply.',
            pass:'Cold along the SIDES of your tongue, not down the middle.' }
        : { title:'The inhale test',
            how:'Hold the position and breathe in sharply.',
            pass:'Cold down the CENTRE. If it is cold at the sides, air is still escaping laterally.' };

    case 'place':
      return { title:'Find the cold spot',
               how:'Hold the articulation without voicing it and breathe IN sharply.',
               pass:'The cold patch marks exactly where your constriction is. It should sit at '
                    + (PLACE_WORDS[to] || to) + '.' };

    case 'articulator':
      if (to === 'apical')
        return { title:'Check for the pocket',
                 how:'Hold the sound and feel underneath your tongue tip with your attention.',
                 pass:'There is an open pocket between the underside of your tip and the floor of your mouth. The tip, not the flat behind it, is the highest part.' };
      if (to === 'laminal')
        return { title:'Check what is highest',
                 how:'Hold the sound and notice which part of your tongue is closest to the roof.',
                 pass:'The flat of the blade, just behind the tip, with no hollow underneath.' };
      if (to === 'dorsal')
        return { title:'Check what is highest',
                 how:'Hold the sound and notice where the contact is.',
                 pass:'The body of your tongue is doing the work; the tip is idle behind your teeth.' };
      return null;

    case 'round':
    case 'labialised':
      return to
        ? { title:'Mirror, or fingertips',
            how:'Rest a fingertip at each corner of your mouth and say it.',
            pass:'The corners pull IN and the lips push forward.' }
        : { title:'Mirror, or fingertips',
            how:'Fingertip at each corner of your mouth, say it.',
            pass:'The corners stay wide. Rounding a vowel that should be spread is one of the most audible accent markers.' };

    case 'height':
      return { title:'Count fingers',
               how:'Say the vowel and hold it, then see how many stacked fingers fit between your front teeth.',
               pass:'Roughly one finger for a close vowel, two for mid, three for open. Compare against the vowel you started from — the gap should change in the right direction.' };

    case 'long':
      return to
        ? { title:'Time it',
            how:'Say the short version, then the long one, back to back.',
            pass:'The long one lasts about twice as long. Say them as a pair; length is relative, not absolute.' }
        : { title:'Time it',
            how:'Say them back to back.',
            pass:'Clearly the shorter of the two.' };

    case 'backness':
      return { title:'No reliable self-check', reliable:false,
               how:'Tongue backness has no clean physical test — the inhale trick is too diffuse for vowels.',
               pass:'Use a mirror for the lips and check the rest against a speaker.' };

    case 'rhotic':
      return { title:'No reliable self-check', reliable:false,
               how:'R-colouring can be made by bunching or by curling, and both are correct.',
               pass:'No physical test distinguishes right from wrong here.' };

    default:
      return null;
  }
}

/** one check per changed feature, in the order the steps happen */
function checksFor(bridge){
  const out = [], seen = new Set();
  for (const st of bridge.steps){
    if (seen.has(st.dim)) continue;
    seen.add(st.dim);
    const c = checkFor([st.dim, st.from, st.toVal]);
    if (c) out.push(Object.assign({ dim: st.dim, reliable: true }, c));
  }
  return out;
}

/* ======================================================================== */
/*  Binary heap + multi-source Dijkstra                                     */
/* ======================================================================== */

// ties broken on the node key so a run is reproducible, not heap-order dependent
const lt = (x, y) => x[0] !== y[0] ? x[0] < y[0] : x[1] < y[1];
const le = (x, y) => !lt(y, x);

class Heap {
  constructor(){ this.a = []; }
  get size(){ return this.a.length; }
  push(item){
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      if (le(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop(){
    const a = this.a, top = a[0], last = a.pop();
    if (a.length){
      a[0] = last;
      let i = 0;
      for (;;){
        const l = 2*i+1, r = l+1; let m = i;
        if (l < a.length && lt(a[l], a[m])) m = l;
        if (r < a.length && lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

function search(sources, targets, maxCost){
  maxCost = maxCost ?? 14;
  const dist = new Map(), prev = new Map(), origin = new Map(), seen = new Set();
  const pq = new Heap();

  for (const [k, {cost, seg: s, sym, kind, langs}] of sources){
    if (!dist.has(k) || cost < dist.get(k)){
      dist.set(k, cost); origin.set(k, [sym, kind, langs]); pq.push([cost, k, s]);
    }
  }

  const want = new Set(targets.keys());
  const found = new Map();

  while (pq.size){
    const [d, k, s] = pq.pop();
    if (seen.has(k)) continue;
    seen.add(k);

    if (want.has(k)){
      found.set(k, [d, s]);
      if (found.size === want.size) break;
    }
    if (d > maxCost) continue;

    for (const [nxt, w, change] of neighbours(s)){
      const nd = d + w;
      if (nd > maxCost) continue;
      const nk = key(nxt);
      if (!dist.has(nk) || nd < dist.get(nk) - 1e-9){
        dist.set(nk, nd);
        prev.set(nk, [k, s, change]);
        origin.set(nk, origin.get(k));
        pq.push([nd, nk, nxt]);
      }
    }
  }

  const out = new Map();
  for (const [k, sym] of targets){
    if (!found.has(k)) continue;
    const [d, endSeg] = found.get(k);
    const path = [];
    let cur = k, curSeg = endSeg;
    while (prev.has(cur)){
      const [pk, pSeg, change] = prev.get(cur);
      path.push({
        to: label(curSeg), do: describe(change),
        dim: change[0], from: change[1], toVal: change[2],
      });
      cur = pk; curSeg = pSeg;
    }
    path.reverse();
    out.set(sym, { cost: d, steps: path, origin: origin.get(k) });
  }
  return out;
}

/* ======================================================================== */
/*  Public API                                                              */
/* ======================================================================== */

const cmpCode = (a,b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * plan(l1, l2) — l1 is one language code or an array of them.
 *
 * With several native languages the inventories are UNIONED before the search
 * runs, so an anchor can come from any of them. This is not the same as running
 * the pairs separately and merging: a Polish-English bilingual learning Mandarin
 * gets the sibilants free from Polish AND the vowels free from English, and for
 * anything still missing the search picks whichever language offers the cheapest
 * route. Each bridge records which language(s) its anchor came from.
 */
function plan(l1, l2Code, alsoKnown){
  const l1Codes = (Array.isArray(l1) ? l1 : [l1]).filter(c => LANGUAGES[c]);
  const l2 = LANGUAGES[l2Code];
  // sounds acquired since the start — they count as owned, and can serve as
  // anchors for anything taught later. This is what makes a curriculum
  // progressive: once you have ʂ, the next retroflex is one step from it
  // rather than two from English /ʃ/.
  const acquired = (alsoKnown || []).filter(s => SYMBOLS[s]);

  // symbol -> [languages that have it], phonemes winning over allophones
  const owners = new Map(), alloOwners = new Map();
  for (const code of l1Codes){
    for (const sym of LANGUAGES[code].phonemes)
      (owners.get(sym) || owners.set(sym, []).get(sym)).push(code);
    for (const sym of (LANGUAGES[code].allophones || []))
      (alloOwners.get(sym) || alloOwners.set(sym, []).get(sym)).push(code);
  }
  for (const sym of acquired)
    if (!owners.has(sym)) owners.set(sym, ['acquired']);
  const l1ph = new Set(owners.keys());
  const l1al = [...alloOwners.keys()].filter(s => !l1ph.has(s));

  const sources = new Map();
  for (const sym of l1ph){
    const s = SYMBOLS[sym];
    sources.set(key(s), { cost:0, seg:s, sym, kind:'phoneme', langs: owners.get(sym) });
  }
  for (const sym of l1al){
    const s = SYMBOLS[sym], k = key(s);
    if (!sources.has(k))
      sources.set(k, { cost:ALLOPHONE_PENALTY, seg:s, sym, kind:'allophone',
                       langs: alloOwners.get(sym) });
  }

  const already = [], fresh = [];
  for (const sym of l2.phonemes) (l1ph.has(sym) ? already : fresh).push(sym);
  // NOTE: "already" means the feature bundles match. It does NOT mean the two
  // sounds are phonetically identical — Spanish /p/ and English /p/ differ in
  // VOT, and this model has no way to see that yet.

  const targets = new Map(fresh.map(s => [key(SYMBOLS[s]), s]));
  const results = search(sources, targets);

  const bridges = [];
  for (const sym of fresh){
    const r = results.get(sym);
    if (!r) continue;
    const kinds = kindsOf(r.steps);
    bridges.push({
      target: sym, targetName: NAMES[sym],
      anchor: r.origin[0], anchorName: NAMES[r.origin[0]], anchorKind: r.origin[1],
      anchorLangs: r.origin[2] || [],   // which native language(s) supply it
      cost: Math.round(r.cost * 100) / 100,
      steps: r.steps,
      // what kind of change the anchor has to make to become the target
      kinds,                                              // ['articulator', ...]
      kindLabel: kinds.length ? kinds.map(d => DIM_LABEL[d]).join(' + ')
                              : 'No change',              // 'Articulator + Phonation'
      kindGloss: kinds.length === 1 ? DIM_GLOSS[kinds[0]]
               : kinds.length === 0 ? 'already in your mouth as an allophone'
               : kinds.length + ' things change at once',
      primary: kinds[0] || 'none',                        // for colour-coding
      compound: kinds.length > 1,
    });
  }
  // codepoint order on ties, so the ordering is stable across locales
  bridges.sort((a,b) => a.cost - b.cost ||
    (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));

  const clusters = {};
  for (const b of bridges) (clusters[b.anchor] = clusters[b.anchor] || []).push(b);
  const collisions = {};
  for (const [a, bs] of Object.entries(clusters)) if (bs.length > 1) collisions[a] = bs;

  const l2set = new Set(l2.phonemes);
  return {
    acquired,
    l1: l1Codes, l1Name: l1Codes.map(c => LANGUAGES[c].name).join(' + '),
    l1Notes: l1Codes.map(c => LANGUAGES[c].notes).filter(Boolean).join(' '),
    l2: l2Code, l2Name: l2.name, l2Notes: l2.notes || '',
    alreadyHave: already.slice().sort(cmpCode),
    bridges, collisions,
    unreachable: fresh.filter(s => !results.has(s)),
    surplus: [...l1ph].filter(s => !l2set.has(s)).sort(cmpCode),
  };
}


/* ========================================================================
   CURRICULUM — walk a frequency-ordered word list and emit lessons.

   The phoneme list is not a syllabus. It is a dependency table, consulted
   only when a word demands something the learner cannot yet say. Most words
   teach nothing new; the ones that do interrupt with exactly the sound they
   need, and then the word.

   Anchors are recomputed as the learner acquires sounds, so a sound taught
   at word 40 can be the starting point for one taught at word 80.
   ======================================================================== */

function curriculum(l1, l2Code, words, opts){
  opts = opts || {};
  const l1Codes = (Array.isArray(l1) ? l1 : [l1]).filter(c => LANGUAGES[c]);

  const owned = new Set();
  for (const c of l1Codes) for (const s of LANGUAGES[c].phonemes) owned.add(s);

  const acquired = [];       // in the order they get taught
  const lessons = [];
  let unteachable = 0;

  for (const w of words){
    const needed = [...new Set(w.phonemes)].filter(p => !owned.has(p));
    const taught = [];

    for (const p of needed){
      // recompute per sound: earlier sounds in this same word are now available
      const r = plan(l1Codes, l2Code, acquired);
      const b = r.bridges.find(x => x.target === p);
      if (b){
        taught.push(b);
        lessons.push({ type:'sound', bridge:b, forWord:w, rank:w.rank });
      } else {
        unteachable++;
        lessons.push({ type:'sound', bridge:null, target:p, forWord:w, rank:w.rank });
      }
      owned.add(p);
      acquired.push(p);
    }

    lessons.push({ type:'word', word:w, rank:w.rank,
                   newSounds: taught.map(b => b.target),
                   free: taught.length === 0 });
  }

  const wordLessons = lessons.filter(l => l.type === 'word');
  return {
    lessons,
    acquired,
    totalWords: wordLessons.length,
    freeWords: wordLessons.filter(l => l.free).length,
    soundsTaught: acquired.length,
    unteachable,
    // how far in before the learner is blocked the first time
    firstBlockAt: (lessons.find(l => l.type === 'sound') || {}).rank || null,
  };
}

function band(cost){
  if (cost <= 0.75) return 'free';
  if (cost <= 1.30) return 'one step';
  if (cost <= 2.60) return 'short';
  if (cost <= 4.50) return 'long';
  return 'hard';
}

root.BridgeEngine = { LANGUAGES, SYMBOLS, NAMES, plan, band, describe,
                      neighbours, valid, key, label,
                      DIM_ORDER, DIM_LABEL, DIM_GLOSS, kindsOf, checksFor, curriculum,
                      PLACE_WORDS, ARTIC_WORDS,
                      ARTIC_WORD: a => ARTIC_WORDS[a] || a };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.BridgeEngine;
