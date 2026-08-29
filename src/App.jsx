import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Search, ArrowLeft, Users, TrendingUp, Zap, Footprints, Clock, Target, X,
  ChevronUp, ChevronDown, Sun, Moon, ChevronLeft, ChevronRight, Layers, Share2, Wind, Activity, Flame, Star, Shield, Shuffle, Trophy, Play, Download,
} from 'lucide-react';
import AsciiField from './AsciiField.jsx';
import reelBrut from './donnees/reel.json';
import { chargerReel, sourcesDe } from './donnees/charger.js';
import BackdropFilm from './BackdropFilm.jsx';

/* =========================================================================
   MOCK DATA — structure calquée sur la sortie attendue du pipeline PIX4TEAM.
   Deux familles de stats :
   - SCORE (pts, 2pts, 3pts, rebonds, passes déc., +/-) : saisies par le
     scoreur pendant le match, croisées avec le temps de jeu du tracking
     pour calculer le +/- automatiquement.
   - MOUVEMENT (distance, vitesse, sprints, touches, temps de jeu) : sorties
     natives du tracking YOLO11 + ByteTrack, sans saisie humaine.
   A remplacer par le vrai CSV/JSON une fois la pipeline + la saisie score
   branchées.

   NB plateforme : TOUT est simulé ici, pour les 7 clubs, afin de prévisualiser
   l'expérience complète (calendrier, effectifs, stats). En prod, chaque club
   n'aura des données que le jour où sa caméra PIX4TEAM 2 est déployée.
   ========================================================================= */

// Canvas 2D ne resout pas les variables CSS : `ctx.fillStyle = SHARE.amber`
// est une valeur invalide, silencieusement ignoree, et le style precedent reste
// actif. Il faut donc lire la variable sur la racine au moment du trace, ce qui
// a aussi l'avantage de suivre le theme clair ou sombre en cours.
/* =========================================================================
   INTERRUPTEUR DES DONNEES FABRIQUEES

   Tout ce qui est invente descend de QUATRE sources et rien d autre: ROSTERS,
   FIXTURES, buildTeamMatches et HIGHLIGHTS. Le reste en derive. Il suffit donc
   de quatre robinets pour eteindre l invention, famille par famille, a mesure
   que la vraie donnee arrive.

   Les deux familles de statistiques sont separees parce qu elles n arriveront
   PAS ensemble: un club peut avoir une camera sans marqueur a la table ce
   soir-la, ou l inverse. Voir DONNEES.md.

   PAR DEFAUT, RIEN N EST FABRIQUE. Le site est vrai a l arrivee et on OPTE
   POUR la demonstration, jamais l inverse. Un defaut qui invente oblige a
   penser a l eteindre; un defaut qui dit la verite ne peut pas se tromper par
   oubli, et c est le seul sens qui protege les clubs reels.

     /                         rien de fabrique  (defaut)
     /?faux=on                 tout allume, mode demonstration
     /?faux=fixtures,score     seules ces familles sont allumees
   ========================================================================= */

const FAMILLES_FAUX = ['rosters', 'fixtures', 'score', 'mouvement', 'highlights'];

function lireFaux(valeur) {
  const out = {};
  const tout = valeur === 'on' || valeur === 'all' || valeur === '1';
  const gardees = new Set(
    valeur && !tout ? valeur.split(',').map((x) => x.trim()) : [],
  );
  for (const k of FAMILLES_FAUX) out[k] = tout || gardees.has(k);
  // Dependances reelles, pas des preferences: il n y a pas de statistique par
  // joueur sans joueurs, ni de match sans calendrier. Une combinaison
  // impossible est corrigee ici plutot que de planter plus bas.
  if (out.score || out.mouvement) { out.rosters = true; out.fixtures = true; }
  // Un temps fort nomme un joueur: sans effectif, il n a personne a designer.
  if (out.highlights) out.rosters = true;
  return out;
}

const FAKE = (() => {
  try {
    return lireFaux(new URLSearchParams(location.search).get('faux'));
  } catch (e) {
    return lireFaux(null);   // pas d URL exploitable: on reste au vrai
  }
})();

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Une carte de partage dessine SON PROPRE fond sombre (#111111) et part vivre
// ailleurs, dans un fil de discussion, hors de tout theme. Sa palette est donc
// fixe et sombre en permanence : y lire les jetons du theme rendrait le texte
// noir sur noir des que le visiteur est en theme clair. C'est exactement le
// defaut corrige dans le heros, a ne pas reintroduire ici.
const SHARE = { ink: '#F6F0E4', dim: '#A2937E', amber: '#FFB020', bg: '#111111' };

function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (rand, [lo, hi]) => lo + rand() * (hi - lo);
const formatPM = (v) => `${v > 0 ? '+' : ''}${v}`;
const pmClass = (v) => (v > 0 ? 'p4t-pm-pos' : v < 0 ? 'p4t-pm-neg' : 'p4t-pm-flat');

function generateQuarterScores(seed, total) {
  const rand = mulberry32(seed);
  const weights = [1, 2, 3, 4].map(() => 0.85 + rand() * 0.45);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const quarters = weights.map((w) => Math.round((total * w) / sumW));
  quarters[3] += total - quarters.reduce((a, b) => a + b, 0);
  return quarters;
}

const MOVEMENT_PROFILE = {
  'Meneur':       { distance: [5.5, 7.2], speed: [24, 28], sprints: [18, 30], touches: [55, 80], time: [28, 38] },
  'Arrière':      { distance: [5.0, 6.8], speed: [23, 27], sprints: [15, 26], touches: [45, 65], time: [25, 35] },
  'Ailier':       { distance: [4.8, 6.5], speed: [22, 26], sprints: [14, 24], touches: [35, 55], time: [24, 34] },
  'Ailier fort':  { distance: [4.2, 5.8], speed: [19, 23], sprints: [10, 18], touches: [30, 48], time: [22, 32] },
  'Pivot':        { distance: [3.6, 5.0], speed: [17, 21], sprints: [6, 14],  touches: [25, 42], time: [20, 30] },
};

const SCORE_PROFILE = {
  'Meneur':       { fg2: [1, 4], fg3: [1, 4], reb: [1, 4],  ast: [4, 10] },
  'Arrière':      { fg2: [2, 5], fg3: [1, 3], reb: [2, 5],  ast: [2, 6] },
  'Ailier':       { fg2: [3, 6], fg3: [0, 2], reb: [3, 7],  ast: [1, 4] },
  'Ailier fort':  { fg2: [3, 7], fg3: [0, 1], reb: [5, 10], ast: [1, 3] },
  'Pivot':        { fg2: [4, 8], fg3: [0, 0], reb: [6, 12], ast: [0, 2] },
};

// Fautes personnelles — barème FIBA (5 fautes = exclusion), plus fréquentes
// sur les postes proches du panier.
const FOULS_PROFILE = {
  'Meneur':       { fouls: [0, 3] },
  'Arrière':      { fouls: [0, 3] },
  'Ailier':       { fouls: [1, 4] },
  'Ailier fort':  { fouls: [1, 5] },
  'Pivot':        { fouls: [2, 5] },
};

/* =========================================================================
   EFFECTIFS — un roster par club (10 joueurs, même répartition de postes)
   ========================================================================= */

const ROSTERS = {
  trident: [
    { id: 'trident-p1',  name: 'Kaïros Monrose',  number: 4,  position: 'Meneur' },
    { id: 'trident-p2',  name: 'Fabrice Anilus',  number: 5,  position: 'Meneur' },
    { id: 'trident-p3',  name: 'Djoulé Cotellon', number: 7,  position: 'Arrière' },
    { id: 'trident-p4',  name: 'Wilfried Numa',   number: 21, position: 'Arrière' },
    { id: 'trident-p5',  name: 'Naël Pulvar',     number: 10, position: 'Ailier' },
    { id: 'trident-p6',  name: 'Yohann Sagesse',  number: 23, position: 'Ailier' },
    { id: 'trident-p7',  name: 'Ryan Dorival',    number: 11, position: 'Ailier fort' },
    { id: 'trident-p8',  name: 'Mickaël Rodon',   number: 9,  position: 'Ailier fort' },
    { id: 'trident-p9',  name: 'Steevy Larcher',  number: 13, position: 'Pivot' },
    { id: 'trident-p10', name: 'Cédric Belfort',  number: 15, position: 'Pivot' },
  ],
  etoile: [
    { id: 'etoile-p1',  name: 'Anderson Théodore', number: 3,  position: 'Meneur' },
    { id: 'etoile-p2',  name: 'Jocelyn Bellony',   number: 6,  position: 'Meneur' },
    { id: 'etoile-p3',  name: 'Steven Firmin',     number: 8,  position: 'Arrière' },
    { id: 'etoile-p4',  name: 'Grégory Gaspard',   number: 14, position: 'Arrière' },
    { id: 'etoile-p5',  name: 'Johan Herelle',     number: 12, position: 'Ailier' },
    { id: 'etoile-p6',  name: 'Nathanaël Isidore', number: 24, position: 'Ailier' },
    { id: 'etoile-p7',  name: 'Loïc Jolimon',      number: 20, position: 'Ailier fort' },
    { id: 'etoile-p8',  name: 'Jordy Kancel',      number: 17, position: 'Ailier fort' },
    { id: 'etoile-p9',  name: 'Kevin Médard',      number: 30, position: 'Pivot' },
    { id: 'etoile-p10', name: 'Manuel Noiret',     number: 22, position: 'Pivot' },
  ],
  requins: [
    { id: 'requins-p1',  name: 'Emmanuel Océan',   number: 1,  position: 'Meneur' },
    { id: 'requins-p2',  name: 'Josué Praneuf',    number: 7,  position: 'Meneur' },
    { id: 'requins-p3',  name: 'Widad Quinault',   number: 10, position: 'Arrière' },
    { id: 'requins-p4',  name: 'Enzo Ravily',      number: 16, position: 'Arrière' },
    { id: 'requins-p5',  name: 'Teddy Séminor',    number: 11, position: 'Ailier' },
    { id: 'requins-p6',  name: 'Alex Théobald',    number: 25, position: 'Ailier' },
    { id: 'requins-p7',  name: 'Yannick Ursulet',  number: 19, position: 'Ailier fort' },
    { id: 'requins-p8',  name: 'Franck Valcin',    number: 34, position: 'Ailier fort' },
    { id: 'requins-p9',  name: 'Bruno Wonoto',     number: 5,  position: 'Pivot' },
    { id: 'requins-p10', name: 'Rudy Yvelin',      number: 28, position: 'Pivot' },
  ],
  zandoli: [
    { id: 'zandoli-p1',  name: 'Jean-Baptiste Zéphir', number: 2,  position: 'Meneur' },
    { id: 'zandoli-p2',  name: 'Erwan Damoiseau',      number: 9,  position: 'Meneur' },
    { id: 'zandoli-p3',  name: 'Sébastien Édouard',    number: 13, position: 'Arrière' },
    { id: 'zandoli-p4',  name: 'Gaël Faustin',         number: 18, position: 'Arrière' },
    { id: 'zandoli-p5',  name: 'Xavier Grandin',       number: 4,  position: 'Ailier' },
    { id: 'zandoli-p6',  name: 'Anthony Hilaire',      number: 23, position: 'Ailier' },
    { id: 'zandoli-p7',  name: 'Dylan Ilmany',         number: 15, position: 'Ailier fort' },
    { id: 'zandoli-p8',  name: 'Christopher Jasmin',   number: 29, position: 'Ailier fort' },
    { id: 'zandoli-p9',  name: 'Nicolas Lauréote',     number: 21, position: 'Pivot' },
    { id: 'zandoli-p10', name: 'Jérémy Mondésir',      number: 33, position: 'Pivot' },
  ],
  ouragan: [
    { id: 'ouragan-p1',  name: 'Maxime Nicolin',   number: 0,  position: 'Meneur' },
    { id: 'ouragan-p2',  name: 'Thierry Orphé',    number: 6,  position: 'Meneur' },
    { id: 'ouragan-p3',  name: 'Patrick Périna',   number: 14, position: 'Arrière' },
    { id: 'ouragan-p4',  name: 'Régis Racine',     number: 10, position: 'Arrière' },
    { id: 'ouragan-p5',  name: 'Ulrich Sylvestre', number: 3,  position: 'Ailier' },
    { id: 'ouragan-p6',  name: 'Wilson Toussaint', number: 22, position: 'Ailier' },
    { id: 'ouragan-p7',  name: 'Kendji Ursin',     number: 17, position: 'Ailier fort' },
    { id: 'ouragan-p8',  name: 'Samuel Valmont',   number: 31, position: 'Ailier fort' },
    { id: 'ouragan-p9',  name: 'Elias Wiltord',    number: 8,  position: 'Pivot' },
    { id: 'ouragan-p10', name: 'Rayan Théodore',   number: 26, position: 'Pivot' },
  ],
  kalinago: [
    { id: 'kalinago-p1',  name: 'Noah Bellony',   number: 1,  position: 'Meneur' },
    { id: 'kalinago-p2',  name: 'Kylian Firmin',  number: 12, position: 'Meneur' },
    { id: 'kalinago-p3',  name: 'Mathis Gaspard', number: 7,  position: 'Arrière' },
    { id: 'kalinago-p4',  name: 'Lucas Herelle',  number: 16, position: 'Arrière' },
    { id: 'kalinago-p5',  name: 'Hugo Isidore',   number: 20, position: 'Ailier' },
    { id: 'kalinago-p6',  name: 'Tom Jolimon',    number: 24, position: 'Ailier' },
    { id: 'kalinago-p7',  name: 'Louis Kancel',   number: 9,  position: 'Ailier fort' },
    { id: 'kalinago-p8',  name: 'Nathan Médard',  number: 32, position: 'Ailier fort' },
    { id: 'kalinago-p9',  name: 'Ilan Noiret',    number: 5,  position: 'Pivot' },
    { id: 'kalinago-p10', name: 'Mattéo Océan',   number: 27, position: 'Pivot' },
  ],
  soufriere: [
    { id: 'soufriere-p1',  name: 'Yohan Praneuf',   number: 2,  position: 'Meneur' },
    { id: 'soufriere-p2',  name: 'Cyril Quinault',  number: 11, position: 'Meneur' },
    { id: 'soufriere-p3',  name: 'Fabien Ravily',   number: 13, position: 'Arrière' },
    { id: 'soufriere-p4',  name: 'Sony Séminor',    number: 19, position: 'Arrière' },
    { id: 'soufriere-p5',  name: 'Guy Théobald',    number: 4,  position: 'Ailier' },
    { id: 'soufriere-p6',  name: 'Marcus Ursulet',  number: 23, position: 'Ailier' },
    { id: 'soufriere-p7',  name: 'Willy Valcin',    number: 15, position: 'Ailier fort' },
    { id: 'soufriere-p8',  name: 'Freddy Wonoto',   number: 29, position: 'Ailier fort' },
    { id: 'soufriere-p9',  name: 'Gilbert Yvelin',  number: 6,  position: 'Pivot' },
    { id: 'soufriere-p10', name: 'Dorian Zéphir',   number: 34, position: 'Pivot' },
  ],
};

// Les 13 clubs restants du répertoire n'ont pas d'effectif écrit à la main —
// on génère 10 joueurs fictifs chacun (même répartition de postes que les
// autres clubs) à partir d'un pool de prénoms/noms, de façon déterministe.
const FIRST_NAME_POOL = [
  'Jonathan', 'Steven', 'Kevin', 'Yannick', 'Franck', 'Bruno', 'Rudy', 'Erwan', 'Sébastien', 'Gaël',
  'Xavier', 'Anthony', 'Dylan', 'Christopher', 'Nicolas', 'Jérémy', 'Maxime', 'Thierry', 'Patrick', 'Régis',
  'Ulrich', 'Wilson', 'Kendji', 'Samuel', 'Elias', 'Rayan', 'Noah', 'Kylian', 'Mathis', 'Lucas',
  'Hugo', 'Tom', 'Louis', 'Nathan', 'Ilan', 'Mattéo', 'Yohan', 'Cyril', 'Fabien', 'Sony',
  'Guy', 'Marcus', 'Willy', 'Freddy', 'Gilbert', 'Dorian', 'Judicaël', 'Steeve', 'Farel', 'Kensley',
];
// Prénoms féminins, pour les rosters des clubs de la compétition féminine.
const FIRST_NAME_POOL_F = [
  'Ludivine', 'Sabrina', 'Vanessa', 'Peggy', 'Christelle', 'Sandra', 'Nadège', 'Karine', 'Sonia', 'Émeline',
  'Cindy', 'Priscilla', 'Laetitia', 'Audrey', 'Stéphanie', 'Cynthia', 'Mélanie', 'Grace', 'Kimberly', 'Naomi',
  'Chloé', 'Léa', 'Manon', 'Camille', 'Inès', 'Lola', 'Zoé', 'Alicia', 'Jade', 'Maëlys',
  'Anaïs', 'Charline', 'Océane', 'Emma', 'Sarah', 'Yasmine', 'Marlène', 'Guylène', 'Josiane', 'Solange',
];
const LAST_NAME_POOL = [
  'Monrose', 'Anilus', 'Cotellon', 'Numa', 'Pulvar', 'Sagesse', 'Dorival', 'Rodon', 'Larcher', 'Belfort',
  'Théodore', 'Bellony', 'Firmin', 'Gaspard', 'Herelle', 'Isidore', 'Jolimon', 'Kancel', 'Médard', 'Noiret',
  'Océan', 'Praneuf', 'Quinault', 'Ravily', 'Séminor', 'Théobald', 'Ursulet', 'Valcin', 'Wonoto', 'Yvelin',
  'Zéphir', 'Damoiseau', 'Édouard', 'Faustin', 'Grandin', 'Hilaire', 'Ilmany', 'Jasmin', 'Lauréote', 'Mondésir',
  'Nicolin', 'Orphé', 'Périna', 'Racine', 'Sylvestre', 'Toussaint', 'Ursin', 'Valmont', 'Wiltord',
  'Cabosse', 'Bottius', 'Coursil', 'Melois', 'Simplice',
];
const ROSTER_POSITIONS = ['Meneur', 'Meneur', 'Arrière', 'Arrière', 'Ailier', 'Ailier', 'Ailier fort', 'Ailier fort', 'Pivot', 'Pivot'];

function buildFictionalRoster(teamId, firstNames = FIRST_NAME_POOL) {
  const usedNumbers = new Set();
  return ROSTER_POSITIONS.map((position, i) => {
    const rand = mulberry32(strHash(`${teamId}-roster-${i}`));
    const first = firstNames[Math.floor(rand() * firstNames.length)];
    const last = LAST_NAME_POOL[Math.floor(rand() * LAST_NAME_POOL.length)];
    let number = Math.floor(rand() * 35);
    let guard = 0;
    while (usedNumbers.has(number) && guard < 40) { number = (number + 7) % 35; guard += 1; }
    usedNumbers.add(number);
    return { id: `${teamId}-p${i + 1}`, name: `${first} ${last}`, number, position };
  });
}

const GENERATED_ROSTER_TEAM_IDS = [
  'carbet', 'ducos', 'goodluck', 'intrepide', 'usacfloreal', 'waks', 'aiglenoir',
  'aiglon', 'sportinglamentin', 'blackstars', 'gauloise', 'larel', 'vauclinois',
];
if (FAKE.rosters) GENERATED_ROSTER_TEAM_IDS.forEach((id) => { ROSTERS[id] = buildFictionalRoster(id); });

// Clubs de la compétition féminine (Pré-nationale féminine LMBB) : quatre
// clubs indépendants + six sections féminines de clubs déjà présents côté
// masculin (courant dans les petits clubs martiniquais, qui font tourner une
// équipe hommes et une équipe femmes sous le même nom).
const FEMININE_ROSTER_TEAM_IDS = [
  'madingrey', 'mucbasket', 'redant', 'twenty4',
  'intrepide-f', 'etoile-f', 'ouragan-f', 'kalinago-f', 'zandoli-f', 'usacfloreal-f',
];
if (FAKE.rosters) FEMININE_ROSTER_TEAM_IDS.forEach((id) => { ROSTERS[id] = buildFictionalRoster(id, FIRST_NAME_POOL_F); });

// Clubs réels de la Ligue Régionale Martiniquaise de Basket-Ball, d'après le
// répertoire officiel des clubs affiliés (toutes disciplines confondues, ici
// filtré basket). Les joueurs et les matchs restent fictifs (pas de vraie
// donnée de licenciés/calendrier), mais les clubs, communes et salles réels.
// Compétitions de la plateforme. Une seule est peuplée pour l'instant
// (Régionale 1 Masculin — les 20 clubs actuels) ; les autres existent pour
// que le sélecteur ait un sens, en attendant de vraies données.
const COMPETITIONS = [
  { id: 'r1-m', label: 'Régionale 1', gender: 'Masculin' },
  { id: 'r2-m', label: 'Régionale 2', gender: 'Masculin' },
  { id: 'r1-f', label: 'Régionale 1', gender: 'Féminin' },
];
function competitionLabel(id) {
  const c = COMPETITIONS.find((x) => x.id === id);
  return c ? `${c.label} · ${c.gender}` : id;
}

const TEAMS = [
  { id: 'trident',   name: 'Arsenal du Robert',        commune: 'Le Robert',       region: 'Martinique', venue: 'Plateau Mansarde Catalogne',  competitionId: 'r2-m', hasData: true },
  { id: 'etoile',    name: 'Golden Star',               commune: 'Fort-de-France',  region: 'Martinique', venue: 'Stade Louis Achille',         competitionId: 'r1-m', hasData: true },
  { id: 'requins',   name: 'Basket Ball Samaritain',    commune: 'Sainte-Marie',    region: 'Martinique', venue: 'Le Palladium',                competitionId: 'r1-m', hasData: true },
  { id: 'zandoli',   name: 'Hirondelle du Marin',       commune: 'Marin',           region: 'Martinique', venue: 'Stade Roger Bonaro',          competitionId: 'r2-m', hasData: true },
  { id: 'ouragan',   name: 'Éclair de Rivière-Salée',   commune: 'Rivière-Salée',   region: 'Martinique', venue: 'Palais des Sports de Rivière-Salée', competitionId: 'r2-m', hasData: true },
  { id: 'kalinago',  name: 'Golden Lion',                commune: 'Saint-Joseph',    region: 'Martinique', venue: 'Hall des Sports Louis Joseph Napol', competitionId: 'r1-m', hasData: true },
  { id: 'soufriere', name: 'Le Rebond Pilotin',          commune: 'Rivière-Pilote',  region: 'Martinique', venue: 'Hall de Rivière-Pilote',      competitionId: 'r2-m', hasData: true },
  { id: 'carbet',           name: 'C.S.C. Carbet',              commune: 'Carbet',            region: 'Martinique', venue: 'Complexe sportif de Carbet',        competitionId: 'r1-m', hasData: true },
  { id: 'ducos',            name: 'Union Sportive Ducossaise',  commune: 'Ducos',             region: 'Martinique', venue: 'Hall Louis Joseph Dogué',           competitionId: 'r1-m', hasData: true },
  { id: 'goodluck',         name: 'Good Luck',                  commune: 'Fort-de-France',    region: 'Martinique', venue: 'Hall de Dillon',                    competitionId: 'r2-m', hasData: true },
  { id: 'intrepide',        name: "L'Intrépide Basket Club",    commune: 'Fort-de-France',    region: 'Martinique', venue: 'Hall Richard Granvorka',            competitionId: 'r2-m', hasData: true },
  { id: 'usacfloreal',      name: 'USAC de Floréal',             commune: 'Fort-de-France',    region: 'Martinique', venue: 'Hall de Floréal',                   competitionId: 'r1-m', hasData: true },
  { id: 'waks',             name: 'Waks Basket Club',           commune: 'Le François',       region: 'Martinique', venue: 'Hall des Sports du François',       competitionId: 'r1-m', hasData: true },
  { id: 'aiglenoir',        name: 'ASC Aigle Noir',              commune: 'Gros-Morne',        region: 'Martinique', venue: 'Hall du Bourg',                     competitionId: 'r1-m', hasData: true },
  { id: 'aiglon',           name: 'Aiglon du Lamentin',         commune: 'Le Lamentin',       region: 'Martinique', venue: 'Plateau Petit Manoir',              competitionId: 'r2-m', hasData: true },
  { id: 'sportinglamentin', name: 'Sporting Club Lamentinois',  commune: 'Le Lamentin',       region: 'Martinique', venue: 'Palais des Sports de Petit Manoir', competitionId: 'r2-m', hasData: true },
  { id: 'blackstars',       name: 'AS Black Stars',              commune: 'Saint-Esprit',      region: 'Martinique', venue: 'Hall François Pavila',              competitionId: 'r1-m', hasData: true },
  { id: 'gauloise',         name: 'La Gauloise de Trinité',     commune: 'Trinité',           region: 'Martinique', venue: 'Palais des Sports de Beauséjour',   competitionId: 'r1-m', hasData: true },
  { id: 'larel',            name: 'Larel Basket Club',           commune: 'Trois-Îlets',       region: 'Martinique', venue: 'Hall du Bord de Mer',               competitionId: 'r2-m', hasData: true },
  { id: 'vauclinois',       name: 'Club Sportif Vauclinois',    commune: 'Vauclin',           region: 'Martinique', venue: 'Hall Gaétan Lycir',                 competitionId: 'r2-m', hasData: true },

  // Compétition féminine (Pré-nationale féminine LMBB).
  { id: 'madingrey',       name: 'Madin Grey Basket Club',           commune: 'Fort-de-France', region: 'Martinique', venue: 'Hall du Champ de Mars',              competitionId: 'r1-f', hasData: true },
  { id: 'mucbasket',       name: 'Martinique Université Club',       commune: 'Schoelcher',     region: 'Martinique', venue: 'Gymnase du Campus de Schoelcher',    competitionId: 'r1-f', hasData: true },
  { id: 'redant',          name: 'Red Ant Basket Ball',              commune: 'Fort-de-France', region: 'Martinique', venue: 'Hall de Terreville',                 competitionId: 'r1-f', hasData: true },
  { id: 'twenty4',         name: 'Twenty 4 Basket-Ball',             commune: 'Fort-de-France', region: 'Martinique', venue: 'Hall de Sainte-Thérèse',             competitionId: 'r1-f', hasData: true },
  { id: 'intrepide-f',     name: "L'Intrépide Basket Club (Féminin)", commune: 'Fort-de-France', region: 'Martinique', venue: 'Hall Richard Granvorka',             competitionId: 'r1-f', hasData: true },
  { id: 'etoile-f',        name: 'Golden Star (Féminin)',            commune: 'Fort-de-France', region: 'Martinique', venue: 'Stade Louis Achille',                competitionId: 'r1-f', hasData: true },
  { id: 'ouragan-f',       name: 'Éclair de Rivière-Salée (Féminin)', commune: 'Rivière-Salée',  region: 'Martinique', venue: 'Palais des Sports de Rivière-Salée', competitionId: 'r1-f', hasData: true },
  { id: 'kalinago-f',      name: 'Golden Lion (Féminin)',            commune: 'Saint-Joseph',   region: 'Martinique', venue: 'Hall des Sports Louis Joseph Napol', competitionId: 'r1-f', hasData: true },
  { id: 'zandoli-f',       name: 'Hirondelle du Marin (Féminin)',    commune: 'Marin',          region: 'Martinique', venue: 'Stade Roger Bonaro',                 competitionId: 'r1-f', hasData: true },
  { id: 'usacfloreal-f',   name: 'USAC de Floréal (Féminin)',        commune: 'Fort-de-France', region: 'Martinique', venue: 'Hall de Floréal',                    competitionId: 'r1-f', hasData: true },
];
// hasData etait code en dur a true pour les 30 clubs, ce qui rendait l etat
// "pas encore de captation" inatteignable. Il est desormais DERIVE: un club a
// des donnees s il a un effectif et au moins un match joue.
function teamHasData(id) {
  const l = LEAGUE[id];
  if (!l) return false;
  return (l.roster || []).length > 0 && (l.matches || []).some((m) => m.played);
}

function teamName(id) {
  const t = TEAMS.find((x) => x.id === id);
  return t ? t.name : id;
}
// Un match se joue dans la salle de l'équipe qui reçoit.
function venueName(homeTeamId) {
  const t = TEAMS.find((x) => x.id === homeTeamId);
  return t ? t.venue : '';
}

/* =========================================================================
   CALENDRIER — une seule liste de rencontres, source unique de vérité
   ========================================================================= */

// Construit, pour une liste de clubs d'une même compétition, un calendrier
// complet : deux tournées jouées avec score, une troisième à venir sans
// score. Réutilisé séparément pour chaque compétition (R1/R2 masculin,
// féminin) afin qu'aucun match ne mélange deux compétitions différentes.
function buildDivisionFixtures(ids, prefix, playedStartDate, upcomingStartDate, scoreRange = [58, 90]) {
  const n = ids.length;
  const playedPairs = [];
  for (let i = 0; i < n; i++) playedPairs.push([i, (i + 1) % n]);
  for (let i = 0; i < n; i++) playedPairs.push([i, (i + 2) % n]);
  const playedStart = new Date(playedStartDate);
  const [lo, hi] = scoreRange;
  const playedFixtures = playedPairs.map((pair, idx) => {
    const id = `${prefix}p${idx + 1}`;
    const homeTeamId = ids[pair[0]];
    const awayTeamId = ids[pair[1]];
    const rand = mulberry32(strHash(id + '-score'));
    let homeScore = lo + Math.round(rand() * (hi - lo));
    let awayScore = lo + Math.round(rand() * (hi - lo));
    if (homeScore === awayScore) homeScore += 1;
    const d = new Date(playedStart.getTime() + idx * 4 * 24 * 3600 * 1000);
    const date = d.toISOString().slice(0, 10);
    return { id, date, homeTeamId, awayTeamId, homeScore, awayScore };
  });

  const upcomingPairs = [];
  for (let i = 0; i < n; i++) upcomingPairs.push([i, (i + 3) % n]);
  const upcomingStart = new Date(upcomingStartDate);
  const upcomingFixtures = upcomingPairs.map((pair, idx) => {
    const id = `${prefix}u${idx + 1}`;
    const homeTeamId = ids[pair[0]];
    const awayTeamId = ids[pair[1]];
    const d = new Date(upcomingStart.getTime() + idx * 3 * 24 * 3600 * 1000);
    const date = d.toISOString().slice(0, 10);
    return { id, date, homeTeamId, awayTeamId };
  });

  return [...playedFixtures, ...upcomingFixtures];
}

const FIXTURES = !FAKE.fixtures ? [] : [
  ...buildDivisionFixtures(
    ['etoile', 'requins', 'kalinago', 'carbet', 'ducos', 'usacfloreal', 'waks', 'aiglenoir', 'blackstars', 'gauloise'],
    'r1m', '2025-10-08T00:00:00Z', '2026-02-02T00:00:00Z'
  ),
  ...buildDivisionFixtures(
    ['trident', 'intrepide', 'goodluck', 'zandoli', 'aiglon', 'soufriere', 'sportinglamentin', 'larel', 'vauclinois', 'ouragan'],
    'r2m', '2025-10-09T00:00:00Z', '2026-02-03T00:00:00Z'
  ),
  ...buildDivisionFixtures(
    ['madingrey', 'mucbasket', 'redant', 'twenty4', 'intrepide-f', 'etoile-f', 'ouragan-f', 'kalinago-f', 'zandoli-f', 'usacfloreal-f'],
    'r1f', '2025-10-10T00:00:00Z', '2026-02-05T00:00:00Z', [52, 82]
  ),
];

// Construit, pour un club donné, la liste de ses matchs avec les stats de
// CHAQUE joueur de son propre effectif (mêmes profils par poste que Trident).
function buildTeamMatches(teamId) {
  const roster = ROSTERS[teamId];
  return FIXTURES
    .filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId)
    .map((f) => {
      const isHome = f.homeTeamId === teamId;
      const opponentId = isHome ? f.awayTeamId : f.homeTeamId;

      // Match pas encore joué : pas de score, donc pas de stats à générer.
      // On renvoie une fiche allégée, utilisée uniquement par le calendrier.
      if (f.homeScore == null) {
        return {
          id: f.id,
          date: f.date,
          opponent: teamName(opponentId),
          opponentTeamId: opponentId,
          isHome,
          homeLabel: teamName(f.homeTeamId),
          awayLabel: teamName(f.awayTeamId),
          played: false,
        };
      }

      const scoreFor = isHome ? f.homeScore : f.awayScore;
      const scoreAgainst = isHome ? f.awayScore : f.homeScore;
      const netScore = scoreFor - scoreAgainst;
      const seedKey = `${f.id}-${teamId}`;

      const raw = roster.map((p) => {
        const rand = mulberry32(strHash(p.id + seedKey));
        const mprof = MOVEMENT_PROFILE[p.position];
        const sprof = SCORE_PROFILE[p.position];
        // Famille MOUVEMENT: sortie du tracking, sans saisie humaine. Eteinte,
        // elle laisse les champs a null plutot qu a zero, parce qu un zero se
        // lit comme une mesure et null se lit comme une absence.
        const movement = FAKE.mouvement
          ? {
              distanceKm: +lerp(rand, mprof.distance).toFixed(2),
              maxSpeedKmh: +lerp(rand, mprof.speed).toFixed(1),
              sprints: Math.round(lerp(rand, mprof.sprints)),
              ballTouches: Math.round(lerp(rand, mprof.touches)),
              effectiveMin: Math.round(lerp(rand, mprof.time)),
            }
          : { distanceKm: null, maxSpeedKmh: null, sprints: null, ballTouches: null, effectiveMin: null };
        const fg2Raw = lerp(rand, sprof.fg2);
        const fg3Raw = lerp(rand, sprof.fg3);
        const reb = Math.round(lerp(rand, sprof.reb));
        const ast = Math.round(lerp(rand, sprof.ast));
        const fprof = FOULS_PROFILE[p.position];
        const fouls = Math.min(5, Math.round(lerp(rand, fprof.fouls)));
        const pmSeed = rand();
        return { playerId: p.id, movement, fg2Raw, fg3Raw, reb, ast, fouls, pmSeed };
      });

      const rawPtsSum = raw.reduce((a, r) => a + r.fg2Raw * 2 + r.fg3Raw * 3, 0);
      const scale = rawPtsSum > 0 ? scoreFor / rawPtsSum : 1;

      // Famille SCORE: saisie par le marqueur a la table. Eteinte, elle laisse
      // null elle aussi. Le +/- est croise des DEUX familles: il n existe que
      // si le score ET le temps de jeu mesure sont la, ce qui est exactement la
      // regle enoncee par Benoit dans son commentaire d en-tete.
      const players = raw.map((r) => {
        if (!FAKE.score) {
          return {
            playerId: r.playerId, pts: null, fg2Made: null, fg3Made: null,
            reb: null, ast: null, fouls: null, plusMinus: null, ...r.movement,
          };
        }
        const fg2Made = Math.max(0, Math.round(r.fg2Raw * scale));
        const fg3Made = Math.max(0, Math.round(r.fg3Raw * scale));
        const pts = fg2Made * 2 + fg3Made * 3;
        const plusMinus = FAKE.mouvement
          ? Math.round(netScore * (0.35 + r.pmSeed * 0.75) + (r.pmSeed - 0.5) * 12)
          : null;
        return { playerId: r.playerId, pts, fg2Made, fg3Made, reb: r.reb, ast: r.ast, fouls: r.fouls, plusMinus, ...r.movement };
      });

      return {
        id: f.id,
        date: f.date,
        opponent: teamName(opponentId),
        opponentTeamId: opponentId,
        isHome,
        played: true,
        scoreFor,
        scoreAgainst,
        homeLabel: teamName(f.homeTeamId),
        awayLabel: teamName(f.awayTeamId),
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        homeQuarters: generateQuarterScores(strHash(f.id + '-home-q'), f.homeScore),
        awayQuarters: generateQuarterScores(strHash(f.id + '-away-q'), f.awayScore),
        players,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// LEAGUE[teamId] = { roster, matches } — précalculé une fois pour tous les clubs.
// Les 7 effectifs ecrits a la main sont dans l objet litteral ROSTERS, donc ils
// ne passent pas par buildFictionalRoster: il faut les retirer ici, sinon ils
// survivraient a l interrupteur.
//
// On REMPLACE par un tableau vide au lieu de supprimer la cle: une dizaine
// d endroits font ROSTERS[id].map ou .find sans garde, et supprimer la cle les
// fait planter. Un effectif vide est un etat legitime, une cle absente non.
if (!FAKE.rosters) {
  for (const k of Object.keys(ROSTERS)) delete ROSTERS[k];
  TEAMS.forEach((t) => { ROSTERS[t.id] = []; });
}

/* =========================================================================
   LE REEL PAR-DESSUS LE VIDE

   Le reel gagne toujours sur le fabrique: si une source donne un effectif ou un
   calendrier, il REMPLACE ce qui existait, il ne s y ajoute pas. Melanger du
   vrai et de l invente dans la meme liste serait le pire des deux mondes,
   puisque plus personne ne saurait distinguer les lignes.
   ========================================================================= */
const REEL = chargerReel(reelBrut, TEAMS.map((t) => t.id));
const SOURCES = sourcesDe(REEL);

for (const [clubId, joueurs] of Object.entries(REEL.effectifs)) {
  if (joueurs.length) ROSTERS[clubId] = joueurs;
}
if (REEL.calendrier.length) {
  FIXTURES.length = 0;
  FIXTURES.push(...REEL.calendrier);
}

const LEAGUE = {};
TEAMS.forEach((t) => {
  LEAGUE[t.id] = { roster: ROSTERS[t.id] || [], matches: buildTeamMatches(t.id) };
});

function getPlayerHistory(teamId, playerId) {
  return LEAGUE[teamId].matches
    .filter((m) => m.played)
    .map((m) => ({ ...m.players.find((ps) => ps.playerId === playerId), matchId: m.id, date: m.date, opponent: m.opponent, opponentTeamId: m.opponentTeamId, scoreFor: m.scoreFor, scoreAgainst: m.scoreAgainst }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function getPlayerCareer(teamId, playerId) {
  const hist = getPlayerHistory(teamId, playerId);
  const n = hist.length || 1;
  const sum = (k) => hist.reduce((acc, h) => acc + h[k], 0);
  return {
    matchesPlayed: hist.length,
    totalPoints: sum('pts'),
    ppg: +(sum('pts') / n).toFixed(1),
    totalReb: sum('reb'),
    rpg: +(sum('reb') / n).toFixed(1),
    totalAst: sum('ast'),
    apg: +(sum('ast') / n).toFixed(1),
    avgPlusMinus: Math.round(sum('plusMinus') / n),
    avgEffectiveMin: Math.round(sum('effectiveMin') / n),
    totalDistance: +sum('distanceKm').toFixed(1),
    avgMaxSpeed: +(sum('maxSpeedKmh') / n).toFixed(1),
    totalSprints: sum('sprints'),
  };
}
function ordinalFr(n) {
  return n === 1 ? '1er' : `${n}e`;
}

// Classement d'un joueur au sein de SA compétition (même division/genre),
// sur les points par match — sert au badge "3e meilleur marqueur" sur sa fiche.
function getPlayerRank(teamId, playerId) {
  const team = TEAMS.find((t) => t.id === teamId);
  const competitionTeams = TEAMS.filter((t) => t.competitionId === team.competitionId);
  const rows = competitionTeams
    .flatMap((t) => ROSTERS[t.id].map((p) => ({ teamId: t.id, playerId: p.id, ppg: getPlayerCareer(t.id, p.id).ppg, matchesPlayed: getPlayerCareer(t.id, p.id).matchesPlayed })))
    .filter((r) => r.matchesPlayed > 0)
    .sort((a, b) => b.ppg - a.ppg);
  const rank = rows.findIndex((r) => r.teamId === teamId && r.playerId === playerId) + 1;
  if (rank === 0) return null;
  return { rank, total: rows.length, competitionId: team.competitionId };
}

// Records personnels du joueur — sa meilleure perf sur UN match de la
// saison, pour chaque catégorie (pas le record de la ligue, le sien à lui).
function getPlayerSeasonBests(teamId, playerId) {
  const hist = getPlayerHistory(teamId, playerId);
  if (hist.length === 0) return null;
  return {
    pts: hist.reduce((a, b) => (b.pts > a.pts ? b : a)),
    reb: hist.reduce((a, b) => (b.reb > a.reb ? b : a)),
    ast: hist.reduce((a, b) => (b.ast > a.ast ? b : a)),
  };
}

function getTeamTotals(match) {
  const n = match.players.length;
  const sum = (k) => match.players.reduce((a, p) => a + p[k], 0);
  return {
    totalPoints: match.scoreFor,
    totalReb: sum('reb'),
    totalAst: sum('ast'),
    netScore: match.scoreFor - match.scoreAgainst,
    totalDistance: +sum('distanceKm').toFixed(1),
    peakSpeed: Math.max(...match.players.map((p) => p.maxSpeedKmh)).toFixed(1),
    totalSprints: sum('sprints'),
    avgEffectiveMin: Math.round(sum('effectiveMin') / n),
  };
}
// Un match sans joueur n a pas de meilleur marqueur. C est un etat legitime
// depuis que les effectifs peuvent etre eteints, pas une anomalie.
function getMatchTopScorer(match) {
  if (!match || !match.players || match.players.length === 0) {
    return { playerId: null, pts: 0 };
  }
  return match.players.reduce((best, p) => (!best || p.pts > best.pts ? p : best), null);
}

// Classement des clubs — victoires/défaites/différentiel calculés à partir du
// calendrier unique (FIXTURES). Trié par victoires puis différentiel de points.
function buildStandings(competitionId = null) {
  const teams = competitionId ? TEAMS.filter((t) => t.competitionId === competitionId) : TEAMS;
  const teamIds = new Set(teams.map((t) => t.id));
  const stats = {};
  teams.forEach((t) => {
    stats[t.id] = { teamId: t.id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
  });
  FIXTURES.filter((f) => f.homeScore != null && teamIds.has(f.homeTeamId) && teamIds.has(f.awayTeamId)).forEach((f) => {
    const home = stats[f.homeTeamId];
    const away = stats[f.awayTeamId];
    home.played += 1; away.played += 1;
    home.pointsFor += f.homeScore; home.pointsAgainst += f.awayScore;
    away.pointsFor += f.awayScore; away.pointsAgainst += f.homeScore;
    if (f.homeScore > f.awayScore) { home.wins += 1; away.losses += 1; }
    else { away.wins += 1; home.losses += 1; }
  });
  return teams
    .map((t) => {
      const s = stats[t.id];
      return {
        teamId: t.id,
        name: t.name,
        played: s.played,
        wins: s.wins,
        losses: s.losses,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        diff: s.pointsFor - s.pointsAgainst,
        winPct: s.played ? Math.round((s.wins / s.played) * 100) : 0,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.diff - a.diff);
}

// Flux de matchs "toutes équipes confondues", triés du plus récent au plus
// ancien. Réutilisé sur l'accueil (aperçu) et sur la page "Derniers matchs".
function buildLeagueFeed() {
  return FIXTURES
    .filter((f) => f.homeScore != null)
    .map((f) => {
      const homeMatch = LEAGUE[f.homeTeamId].matches.find((m) => m.id === f.id);
      const awayMatch = LEAGUE[f.awayTeamId].matches.find((m) => m.id === f.id);
      const homeTop = getMatchTopScorer(homeMatch);
      const awayTop = getMatchTopScorer(awayMatch);
      const bestIsHome = homeTop.pts >= awayTop.pts;
      const topTeamId = bestIsHome ? f.homeTeamId : f.awayTeamId;
      // Sans effectif, un match a un score mais personne a designer comme
      // meilleur marqueur. On renvoie une entree explicitement vide plutot que
      // de deréférencer un joueur absent.
      const topPlayer = (ROSTERS[topTeamId] || []).find(
        (p) => p.id === (bestIsHome ? homeTop.playerId : awayTop.playerId),
      ) || null;
      const topPts = bestIsHome ? homeTop.pts : awayTop.pts;
      return {
        id: f.id,
        date: f.date,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        competitionId: TEAMS.find((t) => t.id === f.homeTeamId).competitionId,
        homeLabel: teamName(f.homeTeamId),
        awayLabel: teamName(f.awayTeamId),
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        topScorer: topPlayer ? { id: topPlayer.id, teamId: topTeamId, name: topPlayer.name, pts: topPts } : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Joueur de la semaine — la meilleure perf individuelle du dernier match
// joué, toutes équipes confondues. Pas de notion de "semaine" réelle avec des
// données simulées, donc on prend le match le plus récent comme repère.
// Meilleure perf individuelle d'un match donné (une "semaine" = un match ici,
// faute de vrai calendrier daté). Réutilisé pour la semaine en cours ET pour
// l'historique des anciens joueurs de la semaine.
function getWeeklyFeatured(matchId) {
  const fixture = FIXTURES.find((f) => f.id === matchId);
  if (!fixture) return null;
  const homeMatch = LEAGUE[fixture.homeTeamId].matches.find((m) => m.id === matchId);
  const awayMatch = LEAGUE[fixture.awayTeamId].matches.find((m) => m.id === matchId);
  const homeTop = getMatchTopScorer(homeMatch);
  const awayTop = getMatchTopScorer(awayMatch);
  const bestIsHome = homeTop.pts >= awayTop.pts;
  const teamId = bestIsHome ? fixture.homeTeamId : fixture.awayTeamId;
  const opponentId = bestIsHome ? fixture.awayTeamId : fixture.homeTeamId;
  const teamMatch = bestIsHome ? homeMatch : awayMatch;
  const stat = bestIsHome ? homeTop : awayTop;
  const player = (ROSTERS[teamId] || []).find((p) => p.id === stat.playerId);
  // Sans effectif, on sait qu un match a eu lieu mais pas qui l a marque: il n y
  // a donc pas de vedette de la semaine. null, et l appelant n affiche rien.
  if (!player) return null;
  return { fixture, teamMatch, player, teamId, stat, opponentName: teamName(opponentId) };
}

function getWeeklyFeaturedHistory() {
  return FIXTURES.filter((f) => f.homeScore != null).sort((a, b) => b.date.localeCompare(a.date)).map((f) => getWeeklyFeatured(f.id)).filter(Boolean);
}

// Sans aucun match joue, il n y a pas de joueur de la semaine. C est un etat
// legitime depuis que les donnees fabriquees peuvent etre eteintes, pas une
// anomalie: on renvoie null et l appelant n affiche pas la section.
function getPlayerOfTheWeek() {
  const played = FIXTURES.filter((f) => f.homeScore != null).sort((a, b) => b.date.localeCompare(a.date));
  if (!played.length) return null;
  return getWeeklyFeatured(played[0].id);
}

// Records de la saison : la meilleure perf individuelle par catégorie
// (points, rebonds, passes, 3pts), toutes équipes et tous matchs confondus.
const RECORD_CATEGORIES = [
  { key: 'pts', label: 'Points', icon: Target },
  { key: 'reb', label: 'Rebonds', icon: Layers },
  { key: 'ast', label: 'Passes déc.', icon: Share2 },
  { key: 'fg3Made', label: '3 points', icon: Star },
];

function getSeasonRecords(competitionId = null) {
  const best = {};
  RECORD_CATEGORIES.forEach((c) => { best[c.key] = null; });
  const teams = competitionId ? TEAMS.filter((t) => t.competitionId === competitionId) : TEAMS;

  teams.forEach((t) => {
    LEAGUE[t.id].matches.filter((m) => m.played).forEach((m) => {
      m.players.forEach((ps) => {
        RECORD_CATEGORIES.forEach((c) => {
          const value = ps[c.key];
          if (!best[c.key] || value > best[c.key].value) {
            // Un record sans joueur identifiable n en est pas un: sans effectif,
            // on sait qu un score a ete realise mais pas par qui. On n enregistre
            // donc rien plutot que d enregistrer une entree au joueur absent, que
            // l affichage deréférence ensuite.
            const player = (ROSTERS[t.id] || []).find((p) => p.id === ps.playerId);
            if (player) best[c.key] = { value, player, teamId: t.id, opponent: m.opponent, date: m.date };
          }
        });
      });
    });
  });

  // Sans match joue il n y a pas de record. On ne renvoie donc PAS une entree
  // au record null, que les appelants deréférencent sans garde: on renvoie une
  // liste plus courte, ce qui est la description honnete de la situation.
  return RECORD_CATEGORIES.map((c) => ({ ...c, record: best[c.key] })).filter((c) => c.record);
}

// Records "d'équipe" (pas un joueur en particulier) : plus gros score, plus
// grand écart, plus grosse production collective de passes/rebonds sur un match.
const TEAM_RECORD_CATEGORIES = [
  { key: 'teamPoints', label: 'Points (équipe)', icon: Target },
  { key: 'teamMargin', label: 'Plus grand écart', icon: TrendingUp },
  { key: 'teamAssists', label: 'Passes déc. (équipe)', icon: Share2 },
  { key: 'teamRebounds', label: 'Rebonds (équipe)', icon: Layers },
];

function getTeamSeasonRecords(competitionId = null) {
  const teams = competitionId ? TEAMS.filter((t) => t.competitionId === competitionId) : TEAMS;
  let bestPoints = null, bestMargin = null, bestAssists = null, bestRebounds = null;

  teams.forEach((t) => {
    LEAGUE[t.id].matches.filter((m) => m.played).forEach((m) => {
      if (!bestPoints || m.scoreFor > bestPoints.value) {
        bestPoints = { value: m.scoreFor, teamId: t.id, opponent: m.opponent, date: m.date };
      }
      const margin = m.scoreFor - m.scoreAgainst;
      if (margin > 0 && (!bestMargin || margin > bestMargin.value)) {
        bestMargin = { value: margin, teamId: t.id, opponent: m.opponent, date: m.date };
      }
      const totalAst = m.players.reduce((a, p) => a + p.ast, 0);
      const totalReb = m.players.reduce((a, p) => a + p.reb, 0);
      if (!bestAssists || totalAst > bestAssists.value) {
        bestAssists = { value: totalAst, teamId: t.id, opponent: m.opponent, date: m.date };
      }
      if (!bestRebounds || totalReb > bestRebounds.value) {
        bestRebounds = { value: totalReb, teamId: t.id, opponent: m.opponent, date: m.date };
      }
    });
  });

  return [
    { ...TEAM_RECORD_CATEGORIES[0], record: bestPoints },
    { ...TEAM_RECORD_CATEGORIES[1], record: bestMargin },
    { ...TEAM_RECORD_CATEGORIES[2], record: bestAssists },
    { ...TEAM_RECORD_CATEGORIES[3], record: bestRebounds },
  ];
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function initials(name) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase();
}

/* =========================================================================
   HIGHLIGHTS — grosses actions de la saison (dunks, 3pts, contres…).
   A remplacer par de vrais clips une fois l'extraction d'actions branchée
   sur la pipeline vidéo. Pour l'instant, juste de quoi visualiser le rendu.
   ========================================================================= */

const HIGHLIGHT_TYPES = {
  dunk:   { label: 'Dunk',          icon: Flame,   thumbClass: 'p4t-highlight-thumb-dunk' },
  '3pts': { label: '3 points',      icon: Star,    thumbClass: 'p4t-highlight-thumb-3pts' },
  block:  { label: 'Contre',        icon: Shield,  thumbClass: 'p4t-highlight-thumb-block' },
  assist: { label: 'Passe déc.',    icon: Share2,  thumbClass: 'p4t-highlight-thumb-3pts' },
  move:   { label: 'Move',          icon: Shuffle, thumbClass: 'p4t-highlight-thumb-dunk' },
  buzzer: { label: 'Buzzer Beater', icon: Clock,   thumbClass: 'p4t-highlight-thumb-block' },
};

const HIGHLIGHTS = !FAKE.highlights ? [] : [
  { id: 'h1', type: 'dunk',   playerId: 'trident-p7',    teamId: 'trident',    opponent: 'Golden Lion',              opponentTeamId: 'kalinago',    duration: '0:14' },
  { id: 'h2', type: '3pts',   playerId: 'kalinago-p2',   teamId: 'kalinago',   opponent: 'Golden Star',              opponentTeamId: 'etoile',      duration: '0:09' },
  { id: 'h3', type: 'block',  playerId: 'ouragan-p9',    teamId: 'ouragan',    opponent: 'Hirondelle du Marin',      opponentTeamId: 'zandoli',     duration: '0:11' },
  { id: 'h4', type: '3pts',   playerId: 'trident-p3',    teamId: 'trident',    opponent: 'Le Rebond Pilotin',        opponentTeamId: 'soufriere',   duration: '0:16' },
  { id: 'h5', type: 'dunk',   playerId: 'zandoli-p9',    teamId: 'zandoli',    opponent: 'Basket Ball Samaritain',   opponentTeamId: 'requins',     duration: '0:13' },
  { id: 'h6', type: 'block',  playerId: 'requins-p3',    teamId: 'requins',    opponent: 'Éclair de Rivière-Salée',  opponentTeamId: 'ouragan',     duration: '0:10' },
  { id: 'h7', type: 'assist', playerId: 'kalinago-p1',   teamId: 'kalinago',   opponent: 'Arsenal du Robert',        opponentTeamId: 'trident',     duration: '0:07' },
  { id: 'h8', type: 'assist', playerId: 'zandoli-p1',    teamId: 'zandoli',    opponent: 'Basket Ball Samaritain',   opponentTeamId: 'requins',     duration: '0:09' },
  { id: 'h9', type: 'move',   playerId: 'etoile-p1',     teamId: 'etoile',     opponent: 'Basket Ball Samaritain',   opponentTeamId: 'requins',     duration: '0:06' },
  { id: 'h10', type: 'buzzer', playerId: 'usacfloreal-p1', teamId: 'usacfloreal', opponent: 'Waks Basket Club',      opponentTeamId: 'waks',        duration: '0:04' },
];

/* Bascule clair/sombre. Par defaut on suit le reglage du systeme ; des que
   le visiteur choisit, son choix est retenu et gagne sur le systeme. */
// Bandeau de demonstration. Permanent, colle sous la barre de navigation, sur
// toutes les vues et dans les deux themes. Les clubs, les communes et les
// salles sont reels; tout le reste est fabrique. Sans cette mention, un
// visiteur lit "Waks Basket Club, 4 matchs, 0 victoire" et le croit, et on
// attribue publiquement a des clubs reels des defaites qu'ils n'ont pas subies.
// Une mention en pied de page ne suffit pas: personne ne descend.
const FAMILLES = {
  rosters: 'les effectifs',
  fixtures: 'le calendrier et les scores',
  score: 'les statistiques de match',
  mouvement: 'les données de course',
  highlights: 'les temps forts',
};

function DemoBanner() {
  // Le reel ECRASE le fabrique, donc une famille couverte par une source reelle
  // n est plus inventee, meme si son interrupteur est allume. Sans ce calcul le
  // bandeau annoncerait comme fabriquees des donnees qui viennent de la ligue.
  const couvertes = new Set();
  if (REEL.compte.calendrier > 0) couvertes.add('fixtures');
  if (REEL.compte.effectifs > 0) couvertes.add('rosters');

  const inventees = Object.keys(FAMILLES).filter((k) => FAKE[k] && !couvertes.has(k));
  const aDuReel = couvertes.size > 0;
  const sources = SOURCES.map((p) => p.source).join(', ');

  // Trois etats, et le bandeau doit dire celui du moment. Il a deja menti deux
  // fois dans cette refonte: une fois en annoncant du fabrique quand il n y en
  // avait plus, une fois en annoncant l attente quand du reel etait arrive.
  if (inventees.length === 0 && !aDuReel) {
    return (
      <div className="p4t-demo-banner" role="note">
        <strong>EN ATTENTE DE CAPTATION.</strong> Les clubs, les communes et les salles
        sont réels. Aucune statistique n'est encore mesurée: rien de ce qui est affiché
        n'est inventé, il n'y a simplement pas encore de données.
      </div>
    );
  }

  if (inventees.length === 0) {
    return (
      <div className="p4t-demo-banner p4t-demo-banner-reel" role="note">
        <strong>DONNÉES RÉELLES.</strong> Source: {sources}. {REEL.compte.joues} match
        {REEL.compte.joues > 1 ? 's' : ''} joué{REEL.compte.joues > 1 ? 's' : ''} sur
        {' '}{REEL.compte.calendrier} au calendrier. Rien de ce qui est affiché n'est inventé.
      </div>
    );
  }

  const tout = inventees.length === Object.keys(FAMILLES).length;
  return (
    <div className="p4t-demo-banner" role="note">
      <strong>DÉMONSTRATION.</strong> Les clubs, les communes et les salles sont réels.
      {tout
        ? " Tous les matchs, scores, joueurs et records affichés sont fabriqués pour montrer à quoi ressemblera la plateforme."
        : ` Sont encore fabriqués: ${inventees.map((k) => FAMILLES[k]).join(', ')}. Le reste attend la captation.`}
      {aDuReel ? ` Données réelles par ailleurs: ${sources}.` : ''}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('matinik-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* stockage indisponible : on retombe sur le systeme */ }
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('matinik-theme', theme); } catch (e) { /* sans effet */ }
  }, [theme]);

  // Tant que le visiteur n'a rien choisi, on continue de suivre le systeme.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = (e) => {
      let chosen = null;
      try { chosen = localStorage.getItem('matinik-theme'); } catch (err) { /* sans effet */ }
      if (!chosen) setTheme(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="p4t-theme-btn"
      onClick={() => setTheme(next)}
      aria-label={next === 'light' ? 'Passer en thème clair' : 'Passer en thème sombre'}
      title={next === 'light' ? 'Thème clair' : 'Thème sombre'}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

/* =========================================================================
   PETITS COMPOSANTS
   ========================================================================= */

// Pastille de club. Les logos sont ceux des clubs REELS, fournis par la ligue.
// La couverture est PARTIELLE, 15 entrees sur 30, donc le repli sur les
// initiales n'est pas une option de confort: c'est le cas de la moitie du
// championnat. La liste est statique pour qu'aucune requete ne parte chercher
// un fichier absent, et le logo est pose sur une pastille claire dans les DEUX
// themes, parce que ces logos sont dessines pour du blanc.
const LOGOS = new Set(['aiglenoir', 'blackstars', 'etoile', 'etoile-f', 'gauloise', 'kalinago', 'kalinago-f', 'madingrey', 'ouragan', 'ouragan-f', 'soufriere', 'trident', 'twenty4', 'usacfloreal', 'usacfloreal-f']);

function ClubBadge({ teamId, name, size = '' }) {
  const cls = `p4t-avatar ${size}`.trim();
  if (!teamId || !LOGOS.has(teamId)) {
    return <span className={cls}>{initials(name).slice(0, 2)}</span>;
  }
  return (
    <span className={`${cls} p4t-avatar-logo`}>
      <img src={`/logos/${teamId}.png`} alt="" aria-hidden="true" loading="lazy" />
    </span>
  );
}

function Tile({ icon: Icon, value, unit, label, sub, variant = 'primary' }) {
  return (
    <div className={`p4t-tile p4t-tile-${variant}`}>
      {variant === 'primary' && (
        <>
          <span className="p4t-rivet p4t-rivet-tl" /><span className="p4t-rivet p4t-rivet-tr" />
          <span className="p4t-rivet p4t-rivet-bl" /><span className="p4t-rivet p4t-rivet-br" />
        </>
      )}
      <Icon size={variant === 'primary' ? 16 : 13} className="p4t-tile-icon" />
      <div className="p4t-tile-value">{value}<span className="p4t-tile-unit">{unit}</span></div>
      <div className="p4t-tile-label">{label}</div>
      {sub && <div className="p4t-tile-sub">{sub}</div>}
    </div>
  );
}

function SubsectionTitle({ children }) {
  return <h3 className="p4t-subsection-title"><Activity size={12} /> {children}</h3>;
}

function CompetitionBadge({ competitionId }) {
  const c = COMPETITIONS.find((x) => x.id === competitionId);
  if (!c) return null;
  return <span className={`p4t-comp-badge p4t-comp-badge-${c.id}`}>{c.label} · {c.gender}</span>;
}

const COMPETITION_CODES = { 'r1-m': 'R1', 'r2-m': 'R2', 'r1-f': 'FEM' };
function CompetitionMiniBadge({ competitionId }) {
  const code = COMPETITION_CODES[competitionId];
  if (!code) return null;
  return <span className={`p4t-comp-mini p4t-comp-mini-${competitionId}`}>{code}</span>;
}

// Sélecteur local (pas global) pour les pages où la compétition change le
// sens des chiffres : classement et leaders. Le reste du site reste unifié.
function CompetitionFilter({ value, onChange }) {
  return (
    <div className="p4t-comp-filter">
      {COMPETITIONS.map((c) => (
        <button
          key={c.id}
          className={`p4t-comp-filter-btn ${value === c.id ? 'p4t-comp-filter-btn-active' : ''}`}
          onClick={() => onChange(c.id)}
        >
          {c.label} <span className="p4t-comp-filter-gender">{c.gender}</span>
        </button>
      ))}
    </div>
  );
}

function ResultBadge({ scoreFor, scoreAgainst }) {
  const win = scoreFor > scoreAgainst;
  return <span className={`p4t-badge ${win ? 'p4t-badge-win' : 'p4t-badge-loss'}`}>{win ? 'V' : 'D'}</span>;
}

// Nom de joueur cliquable, utilisable partout (y compris à l'intérieur d'une
// carte/ligne déjà cliquable ailleurs, grâce au stopPropagation).
function PlayerLink({ teamId, playerId, name, onOpenPlayer, className = '' }) {
  return (
    <span
      className={`p4t-inline-link ${className}`}
      role="link"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onOpenPlayer(teamId, playerId); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenPlayer(teamId, playerId); } }}
    >
      {name}
    </span>
  );
}

// Nom de club cliquable, même principe.
function TeamLink({ teamId, name, onSelectTeam, className = '' }) {
  return (
    <span
      className={`p4t-inline-link ${className}`}
      role="link"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onSelectTeam(teamId); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelectTeam(teamId); } }}
    >
      {name}
    </span>
  );
}

function MatchCard({ team, match, onClick, onSelectTeam, onOpenPlayer }) {
  const roster = ROSTERS[team.id];
  const top = getMatchTopScorer(match);
  const topPlayer = (roster || []).find((p) => p.id === top.playerId) || null;
  return (
    <button className="p4t-match-card" onClick={onClick}>
      <div className="p4t-match-card-top">
        <span className="p4t-match-card-date">{formatDate(match.date)}</span>
        <ResultBadge scoreFor={match.scoreFor} scoreAgainst={match.scoreAgainst} />
      </div>
      <div className="p4t-match-card-opponent">
        <TeamLink teamId={team.id} name={team.name} onSelectTeam={onSelectTeam} /> <span className="p4t-vs">vs</span>{' '}
        <TeamLink teamId={match.opponentTeamId} name={match.opponent} onSelectTeam={onSelectTeam} />
      </div>
      <div className="p4t-match-card-score">{match.scoreFor} <span className="p4t-score-sep">–</span> {match.scoreAgainst}</div>
      <div className="p4t-match-card-stats">
        <span className="p4t-chip-primary">
          <Target size={13} />
          {topPlayer ? (
            <>
              <PlayerLink teamId={team.id} playerId={topPlayer.id} name={topPlayer.name.split(' ')[0]} onOpenPlayer={onOpenPlayer} />
              {' '}— {top.pts} pts
            </>
          ) : 'meilleur marqueur non renseigné'}
        </span>
      </div>
    </button>
  );
}

// Carte neutre pour les vues "toutes équipes confondues" : pas de badge V/D,
// puisque ni l'une ni l'autre équipe n'est "nous" depuis l'accueil.
// Forme récente d'un club : les N derniers résultats joués, carré coloré +
// lettre (vert/V pour une victoire, rouge/D pour une défaite), du plus ancien
// au plus récent (le plus récent à droite).
function FormBadges({ teamId, count = 5 }) {
  const recent = LEAGUE[teamId].matches
    .filter((m) => m.played)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count);
  if (recent.length === 0) return <span className="p4t-form-empty">—</span>;
  return (
    <div className="p4t-form-row">
      {recent.map((m) => {
        const win = m.scoreFor > m.scoreAgainst;
        return (
          <span key={m.id} className={`p4t-form-badge ${win ? 'p4t-form-win' : 'p4t-form-loss'}`}>
            {win ? 'V' : 'D'}
          </span>
        );
      })}
    </div>
  );
}

function StandingsTable({ standings, onSelectTeam, full = false }) {
  return (
    <div className="p4t-table-wrap">
      <table className="p4t-table">
        <thead>
          <tr>
            <th className="p4t-th-name">Club</th>
            <th>MJ</th>
            <th>V</th>
            <th>D</th>
            {full && <th>PP</th>}
            {full && <th>PC</th>}
            <th>Diff</th>
            {full && <th>%V</th>}
            <th>Forme</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr key={s.teamId} onClick={() => onSelectTeam(s.teamId)} className="p4t-tr-click">
              <td className="p4t-td-name">
                <span className="p4t-standing-rank">{i + 1}</span>
                <ClubBadge teamId={s.teamId} name={s.name} size="p4t-avatar-sm" />
                <span>{s.name}</span>
              </td>
              <td>{s.played}</td>
              <td>{s.wins}</td>
              <td>{s.losses}</td>
              {full && <td>{s.pointsFor}</td>}
              {full && <td>{s.pointsAgainst}</td>}
              <td className={pmClass(s.diff)}>{formatPM(s.diff)}</td>
              {full && <td>{s.winPct}%</td>}
              <td><FormBadges teamId={s.teamId} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeagueMatchCard({ item, onOpenMatch, onSelectTeam, onOpenPlayer }) {
  return (
    <button className="p4t-match-card" onClick={() => onOpenMatch(item.homeTeamId, item.id)}>
      <div className="p4t-match-card-top">
        <span className="p4t-match-card-date">{formatDate(item.date)}</span>
        <CompetitionMiniBadge competitionId={item.competitionId} />
      </div>
      <div className="p4t-match-card-opponent">
        <TeamLink teamId={item.homeTeamId} name={item.homeLabel} onSelectTeam={onSelectTeam} /> <span className="p4t-vs">vs</span>{' '}
        <TeamLink teamId={item.awayTeamId} name={item.awayLabel} onSelectTeam={onSelectTeam} />
      </div>
      <div className="p4t-match-card-score">{item.homeScore} <span className="p4t-score-sep">–</span> {item.awayScore}</div>
      <div className="p4t-match-card-stats">
        <span className="p4t-chip-primary">
          <Target size={13} />
          {item.topScorer ? (
            <>
              <PlayerLink teamId={item.topScorer.teamId} playerId={item.topScorer.id} name={item.topScorer.name.split(' ')[0]} onOpenPlayer={onOpenPlayer} />
              {' '}— {item.topScorer.pts} pts
            </>
          ) : 'meilleur marqueur non renseigné'}
        </span>
      </div>
    </button>
  );
}

const HIGHLIGHT_SHARE_COLORS = {
  dunk:  { accent: 'var(--amber)', glowA: 'rgba(255,176,32,0.4)',  glowB: 'rgba(255,176,32,0.04)' },
  '3pts': { accent: 'var(--teal)', glowA: 'rgba(47,168,160,0.35)', glowB: 'rgba(47,168,160,0.04)' },
  block: { accent: 'var(--ink)', glowA: 'rgba(246,240,228,0.2)', glowB: 'rgba(246,245,240,0.03)' },
  assist: { accent: 'var(--teal)', glowA: 'rgba(47,168,160,0.35)', glowB: 'rgba(47,168,160,0.04)' },
  move:  { accent: 'var(--amber)', glowA: 'rgba(255,176,32,0.4)',  glowB: 'rgba(255,176,32,0.04)' },
  buzzer: { accent: 'var(--ink)', glowA: 'rgba(246,240,228,0.2)', glowB: 'rgba(246,245,240,0.03)' },
};

// Une carte de partage part circuler seule, dans un fil de discussion, sans le
// site autour et donc sans le bandeau. Elle doit porter la mention elle-meme,
// sinon elle se lit comme un vrai resultat. C'est le canal que la revue de
// conception designe comme le risque principal.
function stampDemo(ctx, w, h) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(224,82,60,0.92)';
  ctx.font = '700 17px Inter, sans-serif';
  ctx.fillText('DÉMO · DONNÉES SIMULÉES', w / 2, h - 26);
  ctx.restore();
}

function HighlightShareModal({ highlight, onClose }) {
  const meta = HIGHLIGHT_TYPES[highlight.type];
  const Icon = meta.icon;
  // Le joueur peut etre introuvable si les effectifs sont eteints: on ne
  // deréférence pas un resultat absent.
  const player = (ROSTERS[highlight.teamId] || []).find((p) => p.id === highlight.playerId) || { name: '', number: '' };
  const colors = HIGHLIGHT_SHARE_COLORS[highlight.type];

  const handleDownload = () => {
    const w = 800, h = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = SHARE.bg;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.82, h * 0.14, 20, w * 0.82, h * 0.14, 500);
    glow.addColorStop(0, colors.glowA);
    glow.addColorStop(1, colors.glowB);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SHARE.amber;
    ctx.fillRect(0, 0, w, 6);

    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.ink;
    ctx.font = "600 24px Oswald, sans-serif";
    ctx.fillText('MATINIKSTATS', 48, 76);
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 18px Inter, sans-serif";
    ctx.fillText('HIGHLIGHT', w - 48, 76);

    ctx.textAlign = 'left';
    ctx.fillStyle = colors.accent;
    ctx.font = "700 84px Oswald, sans-serif";
    ctx.fillText(meta.label.toUpperCase(), 48, 400);

    ctx.fillStyle = SHARE.dim;
    ctx.font = "500 22px 'JetBrains Mono', monospace";
    ctx.fillText(highlight.duration, 48, 446);

    ctx.fillStyle = SHARE.ink;
    ctx.font = "700 54px Oswald, sans-serif";
    const nameY = wrapCanvasText(ctx, player.name, 48, 600, w - 96, 58);

    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 22px Inter, sans-serif";
    ctx.fillText(`${teamName(highlight.teamId)} · vs ${highlight.opponent}`, 48, nameY + 50);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(48, 900);
    ctx.lineTo(w - 48, 900);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.amber;
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillText('matinikstats.mq', w - 48, 950);

    stampDemo(ctx, w, h);

    const link = document.createElement('a');
    link.download = `${player.name.replace(/\s+/g, '-').toLowerCase()}-highlight-matinikstats.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="p4t-modal-overlay" onClick={onClose}>
      <div className="p4t-modal" onClick={(e) => e.stopPropagation()}>
        <button className="p4t-modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        <div className={`p4t-sharecard p4t-sharecard-highlight-${highlight.type}`}>
          <div className="p4t-sharecard-topbar" />
          <div className="p4t-sharecard-head">
            <span className="p4t-sharecard-brand">MATINIKSTATS</span>
            <span className="p4t-sharecard-season">HIGHLIGHT</span>
          </div>
          <div className="p4t-sharecard-hl-type"><Icon size={20} />{meta.label}</div>
          <div className="p4t-sharecard-hl-duration">{highlight.duration}</div>
          <div className="p4t-sharecard-name p4t-sharecard-hl-name">{player.name}</div>
          <div className="p4t-sharecard-meta">{teamName(highlight.teamId)} · vs {highlight.opponent}</div>
          <div className="p4t-sharecard-footer p4t-sharecard-footer-center">
            <span className="p4t-sharecard-url">matinikstats.mq</span>
          </div>
        </div>
        <button className="p4t-sharecard-download" onClick={handleDownload}><Download size={15} /> Télécharger l'image</button>
      </div>
    </div>
  );
}

function HighlightCard({ highlight, onOpenPlayer, onSelectTeam }) {
  const [showShare, setShowShare] = useState(false);
  const meta = HIGHLIGHT_TYPES[highlight.type];
  const Icon = meta.icon;
  // Le joueur peut etre introuvable si les effectifs sont eteints: on ne
  // deréférence pas un resultat absent.
  const player = (ROSTERS[highlight.teamId] || []).find((p) => p.id === highlight.playerId) || { name: '', number: '' };
  return (
    <>
      <button className="p4t-highlight-card" onClick={() => onOpenPlayer(highlight.teamId, highlight.playerId)}>
        <div className={`p4t-highlight-thumb ${meta.thumbClass}`}>
          <span className="p4t-highlight-badge"><Icon size={11} /> {meta.label}</span>
          <span
            className="p4t-highlight-share-btn"
            role="button"
            tabIndex={0}
            aria-label="Partager ce highlight"
            onClick={(e) => { e.stopPropagation(); setShowShare(true); }}
          >
            <Share2 size={12} />
          </span>
          <span className="p4t-highlight-play"><Play size={18} fill="currentColor" /></span>
          <span className="p4t-highlight-duration">{highlight.duration}</span>
        </div>
        <div className="p4t-highlight-info">
          <div className="p4t-highlight-player">
            <PlayerLink teamId={highlight.teamId} playerId={player.id} name={player.name} onOpenPlayer={onOpenPlayer} />
            <span className="p4t-number">#{player.number}</span>
          </div>
          <div className="p4t-highlight-meta">
            <TeamLink teamId={highlight.teamId} name={teamName(highlight.teamId)} onSelectTeam={onSelectTeam} /> · vs{' '}
            <TeamLink teamId={highlight.opponentTeamId} name={highlight.opponent} onSelectTeam={onSelectTeam} />
          </div>
        </div>
      </button>
      {showShare && <HighlightShareModal highlight={highlight} onClose={() => setShowShare(false)} />}
    </>
  );
}

// Podium des 3 meilleurs marqueurs — affiché en ordre 2/1/3 (comme un vrai
// podium), le 1er avec un avatar plus grand et un plot plus haut.
function Podium({ entries, onOpenPlayer, onSelectTeam }) {
  const order = [1, 0, 2];
  return (
    <div className="p4t-podium">
      {order.map((idx) => {
        const entry = entries[idx];
        if (!entry) return <div key={`empty-${idx}`} className="p4t-podium-slot" />;
        const rank = idx + 1;
        return (
          <button
            key={entry.player.id}
            className={`p4t-podium-slot p4t-podium-${rank}`}
            onClick={() => onOpenPlayer(entry.player.teamId, entry.player.id)}
          >
            <div className="p4t-podium-card">
              <span className={`p4t-avatar ${rank === 1 ? 'p4t-avatar-lg' : ''}`}>{initials(entry.player.name)}</span>
              <div className="p4t-podium-name">{entry.player.name}</div>
              <div className="p4t-podium-team"><TeamLink teamId={entry.player.teamId} name={entry.teamName} onSelectTeam={onSelectTeam} /></div>
              <div className="p4t-podium-ppg">{entry.ppg}<span className="p4t-podium-ppg-unit">pts/m.</span></div>
            </div>
            <div className="p4t-podium-riser">{rank}</div>
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================================
   VUES — PROPRES À UN CLUB
   ========================================================================= */

// Calendrier d'un club : matchs à venir (triés du plus proche au plus loin)
// puis résultats (triés du plus récent au plus ancien).
function TeamCalendarView({ team, onOpenMatch, onSelectTeam, onOpenPlayer }) {
  const all = LEAGUE[team.id].matches;
  const upcoming = all.filter((m) => !m.played).sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter((m) => m.played).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <div className="p4t-section-head">
        <h2 className="p4t-section-title">Calendrier</h2>
        <span className="p4t-section-count"><span className="p4t-demo-tag">démo</span> {all.length} rencontres</span>
      </div>

      {upcoming.length > 0 && (
        <>
          <h3 className="p4t-subsection-title">À venir</h3>
          <div className="p4t-fixture-list p4t-fixture-list-pending">
            <AsciiField
              className="p4t-pending-field"
              seeds={upcoming.slice(0, 6).map((m) => `${team.name} VS ${m.opponent}`.toUpperCase())}
              alpha={0.4}
              speed={0.55}
              converge={0}
            />
            {upcoming.map((m) => (
              <div key={m.id} className="p4t-fixture-row">
                <span className="p4t-fixture-date">{formatDate(m.date)}</span>
                <span className="p4t-fixture-matchup">
                  {team.name} <span className="p4t-vs">vs</span>{' '}
                  <TeamLink teamId={m.opponentTeamId} name={m.opponent} onSelectTeam={onSelectTeam} />
                </span>
                <span className="p4t-fixture-tag">À venir</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="p4t-subsection-title">Résultats</h3>
      <div className="p4t-match-grid">
        {past.map((m) => (
          <MatchCard key={m.id} team={team} match={m} onClick={() => onOpenMatch(m.id)} onSelectTeam={onSelectTeam} onOpenPlayer={onOpenPlayer} />
        ))}
      </div>
    </>
  );
}

function MatchesView({ team, onOpenMatch, onSelectTeam, onOpenPlayer }) {
  const matches = LEAGUE[team.id].matches.filter((m) => m.played);
  return (
    <>
      <section className="p4t-hero">
        <p className="p4t-eyebrow">{team.name} · Saison 2025–2026</p>
        <h1 className="p4t-hero-title">Chaque match, chiffré à la seconde près.</h1>
        <p className="p4t-hero-sub">Points, rebonds, passes décisives, +/- — et toute la donnée de mouvement derrière, captée automatiquement par PIX4TEAM 2.</p>
        <div className="p4t-hero-form">
          <CompetitionBadge competitionId={team.competitionId} />
          <span className="p4t-hero-form-label">Forme récente</span>
          <FormBadges teamId={team.id} />
        </div>
      </section>
      <div className="p4t-section-head">
        <h2 className="p4t-section-title">Matchs</h2>
        <span className="p4t-section-count">{matches.length} rencontres</span>
      </div>
      <div className="p4t-match-grid">
        {matches.slice().reverse().map((m) => (
          <MatchCard key={m.id} team={team} match={m} onClick={() => onOpenMatch(m.id)} onSelectTeam={onSelectTeam} onOpenPlayer={onOpenPlayer} />
        ))}
      </div>
    </>
  );
}

function MatchShareModal({ match, roster, onClose }) {
  const top = getMatchTopScorer(match);
  const topPlayer = (roster || []).find((p) => p.id === top.playerId) || null;

  const handleDownload = () => {
    const w = 800, h = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = SHARE.bg;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.18, h * 0.1, 20, w * 0.18, h * 0.1, 460);
    glow.addColorStop(0, 'rgba(47,168,160,0.28)');
    glow.addColorStop(1, 'rgba(47,168,160,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SHARE.amber;
    ctx.fillRect(0, 0, w, 6);

    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.ink;
    ctx.font = "600 24px Oswald, sans-serif";
    ctx.fillText('MATINIKSTATS', 48, 76);
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 18px Inter, sans-serif";
    ctx.fillText(formatDate(match.date).toUpperCase(), w - 48, 76);

    ctx.textAlign = 'center';
    ctx.fillStyle = SHARE.dim;
    ctx.font = "600 20px Inter, sans-serif";
    let y = wrapCanvasText(ctx, match.homeLabel.toUpperCase(), w / 2, 200, w - 140, 26);

    ctx.fillStyle = SHARE.ink;
    ctx.font = "700 130px 'JetBrains Mono', monospace";
    ctx.fillText(String(match.homeScore), w / 2, y + 130);

    ctx.fillStyle = SHARE.dim;
    ctx.font = "700 34px Oswald, sans-serif";
    ctx.fillText('—', w / 2, y + 190);

    ctx.fillStyle = SHARE.ink;
    ctx.font = "700 130px 'JetBrains Mono', monospace";
    ctx.fillText(String(match.awayScore), w / 2, y + 330);

    ctx.fillStyle = SHARE.dim;
    ctx.font = "600 20px Inter, sans-serif";
    wrapCanvasText(ctx, match.awayLabel.toUpperCase(), w / 2, y + 380, w - 140, 26);

    if (topPlayer) {
      ctx.fillStyle = SHARE.amber;
      ctx.font = "600 24px Inter, sans-serif";
      ctx.fillText(`${topPlayer.name.split(' ')[0]} — ${top.pts} pts`, w / 2, 780);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(48, 900);
    ctx.lineTo(w - 48, 900);
    ctx.stroke();

    ctx.fillStyle = SHARE.amber;
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillText('matinikstats.mq', w / 2, 950);

    stampDemo(ctx, w, h);

    const link = document.createElement('a');
    link.download = `match-${match.id}-matinikstats.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="p4t-modal-overlay" onClick={onClose}>
      <div className="p4t-modal" onClick={(e) => e.stopPropagation()}>
        <button className="p4t-modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        <div className="p4t-sharecard p4t-sharecard-match">
          <div className="p4t-sharecard-topbar" />
          <div className="p4t-sharecard-head">
            <span className="p4t-sharecard-brand">MATINIKSTATS</span>
            <span className="p4t-sharecard-season">{formatDate(match.date)}</span>
          </div>
          <div className="p4t-sharecard-matchup">
            <div className="p4t-sharecard-matchup-team">{match.homeLabel}</div>
            <div className="p4t-sharecard-matchup-score">{match.homeScore}</div>
            <div className="p4t-sharecard-matchup-sep">—</div>
            <div className="p4t-sharecard-matchup-score">{match.awayScore}</div>
            <div className="p4t-sharecard-matchup-team">{match.awayLabel}</div>
          </div>
          {topPlayer && (
            <div className="p4t-sharecard-topscorer">{topPlayer.name.split(' ')[0]} — {top.pts} pts</div>
          )}
          <div className="p4t-sharecard-footer p4t-sharecard-footer-center">
            <span className="p4t-sharecard-url">matinikstats.mq</span>
          </div>
        </div>
        <button className="p4t-sharecard-download" onClick={handleDownload}><Download size={15} /> Télécharger l'image</button>
      </div>
    </div>
  );
}

function MatchView({ team, matchId, onBack, onOpenPlayer, onSelectTeam }) {
  const [sortKey, setSortKey] = useState('pts');
  const [sortDir, setSortDir] = useState('desc');
  const [showShare, setShowShare] = useState(false);
  const match = LEAGUE[team.id].matches.find((m) => m.id === matchId);
  const homeTeamId = match.isHome ? team.id : match.opponentTeamId;
  const awayTeamId = match.isHome ? match.opponentTeamId : team.id;
  const [statsTeamId, setStatsTeamId] = useState(team.id);

  const totals = useMemo(() => getTeamTotals(match), [match]);
  const statsMatch = statsTeamId === team.id ? match : LEAGUE[statsTeamId].matches.find((m) => m.id === matchId);
  const statsRoster = ROSTERS[statsTeamId];
  const rows = useMemo(() => {
    const withNames = statsMatch.players.map((ps) => ({ ...ps, player: statsRoster.find((p) => p.id === ps.playerId) }));
    return withNames.sort((a, b) => (sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
  }, [statsMatch, statsRoster, sortKey, sortDir]);

  const scoreColumns = [
    { key: 'effectiveMin', label: 'MIN' },
    { key: 'pts', label: 'PTS' },
    { key: 'reb', label: 'REB' },
    { key: 'ast', label: 'AST' },
    { key: 'fg2Made', label: '2PTS' },
    { key: 'fg3Made', label: '3PTS' },
    { key: 'fouls', label: 'PF' },
    { key: 'plusMinus', label: '+/-' },
  ];
  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <>
      <div className="p4t-view-top">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Tous les matchs</button>
        <button className="p4t-share-btn" onClick={() => setShowShare(true)}><Share2 size={14} /> Partager</button>
      </div>
      <div className="p4t-scorebug">
        <div className="p4t-scorebug-meta">{formatDate(match.date)} · {match.isHome ? 'Domicile' : 'Extérieur'}</div>
        <div className="p4t-scorebug-row">
          <span className="p4t-scorebug-team"><TeamLink teamId={homeTeamId} name={match.homeLabel} onSelectTeam={onSelectTeam} /></span>
          <span className="p4t-scorebug-score">{match.homeScore}<span className="p4t-score-sep">–</span>{match.awayScore}</span>
          <span className="p4t-scorebug-team p4t-scorebug-team-away"><TeamLink teamId={awayTeamId} name={match.awayLabel} onSelectTeam={onSelectTeam} /></span>
        </div>
      </div>

      <h2 className="p4t-section-title">Résumé</h2>
      <div className="p4t-table-wrap">
        <table className="p4t-table p4t-quarters-table">
          <thead>
            <tr>
              <th className="p4t-th-name">Équipe</th>
              <th>Q1</th>
              <th>Q2</th>
              <th>Q3</th>
              <th>Q4</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p4t-td-name">{match.homeLabel}</td>
              <td>{match.homeQuarters[0]}</td>
              <td>{match.homeQuarters[1]}</td>
              <td>{match.homeQuarters[2]}</td>
              <td>{match.homeQuarters[3]}</td>
              <td className="p4t-quarters-total">{match.homeScore}</td>
            </tr>
            <tr>
              <td className="p4t-td-name">{match.awayLabel}</td>
              <td>{match.awayQuarters[0]}</td>
              <td>{match.awayQuarters[1]}</td>
              <td>{match.awayQuarters[2]}</td>
              <td>{match.awayQuarters[3]}</td>
              <td className="p4t-quarters-total">{match.awayScore}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="p4t-section-title">Stats d'équipe</h2>
      <div className="p4t-tile-row">
        <Tile icon={Clock} value={totals.avgEffectiveMin} unit="min" label="Temps de jeu moyen" />
        <Tile icon={Target} value={totals.totalPoints} unit="" label="Points" />
        <Tile icon={Layers} value={totals.totalReb} unit="" label="Rebonds" />
        <Tile icon={Share2} value={totals.totalAst} unit="" label="Passes déc." />
        <Tile icon={TrendingUp} value={<span className={pmClass(totals.netScore)}>{formatPM(totals.netScore)}</span>} unit="" label="Écart" />
      </div>

      <h2 className="p4t-section-title">Stats individuelles</h2>
      <div className="p4t-comp-filter">
        <button className={`p4t-comp-filter-btn ${statsTeamId === homeTeamId ? 'p4t-comp-filter-btn-active' : ''}`} onClick={() => setStatsTeamId(homeTeamId)}>
          {teamName(homeTeamId)}
        </button>
        <button className={`p4t-comp-filter-btn ${statsTeamId === awayTeamId ? 'p4t-comp-filter-btn-active' : ''}`} onClick={() => setStatsTeamId(awayTeamId)}>
          {teamName(awayTeamId)}
        </button>
      </div>
      <div className="p4t-table-wrap">
        <table className="p4t-table">
          <thead>
            <tr>
              <th className="p4t-th-name">Joueur</th>
              {scoreColumns.map((c) => (
                <th key={c.key}>
                  <button className="p4t-sort-btn" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortKey === c.key && (sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} onClick={() => onOpenPlayer(statsTeamId, r.playerId)} className="p4t-tr-click">
                <td className="p4t-td-name">
                  <span className="p4t-avatar p4t-avatar-sm">{initials(r.player.name)}</span>
                  <span>{r.player.name}<span className="p4t-number">#{r.player.number}</span></span>
                </td>
                <td>{r.effectiveMin}</td>
                <td>{r.pts}</td>
                <td>{r.reb}</td>
                <td>{r.ast}</td>
                <td>{r.fg2Made}</td>
                <td>{r.fg3Made}</td>
                <td>{r.fouls}</td>
                <td className={pmClass(r.plusMinus)}>{formatPM(r.plusMinus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showShare && (
        <MatchShareModal match={match} roster={ROSTERS[team.id]} onClose={() => setShowShare(false)} />
      )}
    </>
  );
}

function PlayersView({ team, onOpenPlayer }) {
  const roster = ROSTERS[team.id];
  return (
    <>
      <div className="p4t-section-head">
        <h2 className="p4t-section-title">Effectif</h2>
        <span className="p4t-section-count">{roster.length} joueurs</span>
      </div>
      <div className="p4t-players-grid">
        {roster.map((p) => {
          const career = getPlayerCareer(team.id, p.id);
          return (
            <button key={p.id} className="p4t-player-card" onClick={() => onOpenPlayer(p.id)}>
              <span className="p4t-avatar">{initials(p.name)}</span>
              <div className="p4t-player-card-info">
                <div className="p4t-player-card-name">{p.name}<span className="p4t-number">#{p.number}</span></div>
                <div className="p4t-player-card-pos">{p.position}</div>
              </div>
              <div className="p4t-player-card-stats">
                <div className="p4t-player-card-stat"><Target size={13} /> {career.ppg} pts/m.</div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// Retour à la ligne manuel pour le texte dessiné sur le canvas (pas de
// wrapping natif avec l'API Canvas 2D).
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, curY);
      line = words[n] + ' ';
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, curY);
  return curY;
}

function ShareCardModal({ player, team, career, onClose }) {
  const handleDownload = () => {
    const w = 800, h = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = SHARE.bg;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.85, h * 0.08, 20, w * 0.85, h * 0.08, 420);
    glow.addColorStop(0, 'rgba(255,176,32,0.35)');
    glow.addColorStop(1, 'rgba(255,176,32,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SHARE.amber;
    ctx.fillRect(0, 0, w, 6);

    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.ink;
    ctx.font = "600 24px Oswald, sans-serif";
    ctx.fillText('MATINIKSTATS', 48, 76);
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 18px Inter, sans-serif";
    ctx.fillText('Saison 2025–2026', w - 48, 76);

    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.amber;
    ctx.font = "600 20px Inter, sans-serif";
    ctx.fillText(team.name.toUpperCase(), 48, 150);
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 17px Inter, sans-serif";
    ctx.fillText(`${team.commune} · ${team.region}`, 48, 176);

    ctx.fillStyle = SHARE.ink;
    ctx.font = "700 66px Oswald, sans-serif";
    const nameBottomY = wrapCanvasText(ctx, player.name, 48, 280, w - 96, 70);

    ctx.fillStyle = SHARE.amber;
    ctx.font = "700 28px Oswald, sans-serif";
    ctx.fillText(`#${player.number}`, 48, nameBottomY + 54);
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 22px Inter, sans-serif";
    ctx.fillText(player.position, 48 + ctx.measureText(`#${player.number}  `).width, nameBottomY + 54);

    const stats = [
      { label: 'PTS/MATCH', value: career.ppg },
      { label: 'REB/MATCH', value: career.rpg },
      { label: 'AST/MATCH', value: career.apg },
    ];
    const statsY = 740;
    const blockW = w / 3;
    ctx.textAlign = 'center';
    stats.forEach((s, i) => {
      const cx = blockW * i + blockW / 2;
      ctx.fillStyle = SHARE.ink;
      ctx.font = "700 58px 'JetBrains Mono', monospace";
      ctx.fillText(s.value, cx, statsY);
      ctx.fillStyle = SHARE.dim;
      ctx.font = "600 15px Inter, sans-serif";
      ctx.fillText(s.label, cx, statsY + 30);
    });

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(48, 850);
    ctx.lineTo(w - 48, 850);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.dim;
    ctx.font = "400 17px Inter, sans-serif";
    ctx.fillText(`${career.matchesPlayed} matchs joués cette saison`, 48, 900);
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.amber;
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillText('matinikstats.mq', w - 48, 940);

    stampDemo(ctx, w, h);

    const link = document.createElement('a');
    link.download = `${player.name.replace(/\s+/g, '-').toLowerCase()}-matinikstats.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="p4t-modal-overlay" onClick={onClose}>
      <div className="p4t-modal" onClick={(e) => e.stopPropagation()}>
        <button className="p4t-modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        <div className="p4t-sharecard">
          <div className="p4t-sharecard-topbar" />
          <div className="p4t-sharecard-head">
            <span className="p4t-sharecard-brand">MATINIKSTATS</span>
            <span className="p4t-sharecard-season">Saison 2025–2026</span>
          </div>
          <div className="p4t-sharecard-team">{team.name.toUpperCase()}</div>
          <div className="p4t-sharecard-loc">{team.commune} · {team.region}</div>
          <div className="p4t-sharecard-name">{player.name}</div>
          <div className="p4t-sharecard-meta"><span className="p4t-sharecard-number">#{player.number}</span>{player.position}</div>
          <div className="p4t-sharecard-stats">
            <div className="p4t-sharecard-stat"><div className="p4t-sharecard-stat-value">{career.ppg}</div><div className="p4t-sharecard-stat-label">PTS/MATCH</div></div>
            <div className="p4t-sharecard-stat"><div className="p4t-sharecard-stat-value">{career.rpg}</div><div className="p4t-sharecard-stat-label">REB/MATCH</div></div>
            <div className="p4t-sharecard-stat"><div className="p4t-sharecard-stat-value">{career.apg}</div><div className="p4t-sharecard-stat-label">AST/MATCH</div></div>
          </div>
          <div className="p4t-sharecard-footer">
            <span>{career.matchesPlayed} matchs joués</span>
            <span className="p4t-sharecard-url">matinikstats.mq</span>
          </div>
        </div>
        <button className="p4t-sharecard-download" onClick={handleDownload}><Download size={15} /> Télécharger l'image</button>
      </div>
    </div>
  );
}

function PlayerView({ team, playerId, onBack, onSelectTeam, onCompare }) {
  const roster = ROSTERS[team.id];
  const player = roster.find((p) => p.id === playerId);
  const history = useMemo(() => getPlayerHistory(team.id, playerId), [team.id, playerId]);
  const career = useMemo(() => getPlayerCareer(team.id, playerId), [team.id, playerId]);
  const rank = useMemo(() => getPlayerRank(team.id, playerId), [team.id, playerId]);
  const seasonBests = useMemo(() => getPlayerSeasonBests(team.id, playerId), [team.id, playerId]);
  const totals = useMemo(() => history.reduce((acc, h) => ({
    min: acc.min + h.effectiveMin,
    pts: acc.pts + h.pts,
    reb: acc.reb + h.reb,
    ast: acc.ast + h.ast,
    fg2: acc.fg2 + h.fg2Made,
    fg3: acc.fg3 + h.fg3Made,
    pf: acc.pf + h.fouls,
    pm: acc.pm + h.plusMinus,
  }), { min: 0, pts: 0, reb: 0, ast: 0, fg2: 0, fg3: 0, pf: 0, pm: 0 }), [history]);
  const chartData = history.map((h) => ({ match: formatDate(h.date).replace(/ \d{4}$/, ''), Points: h.pts, opponent: h.opponent }));
  const [showShare, setShowShare] = useState(false);

  return (
    <>
      <div className="p4t-view-top">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Retour</button>
        <button className="p4t-share-btn" onClick={() => setShowShare(true)}><Share2 size={14} /> Partager</button>
      </div>
      <div className="p4t-profile-header">
        <span className="p4t-avatar p4t-avatar-lg">{initials(player.name)}</span>
        <div>
          <h1 className="p4t-profile-name">{player.name}<span className="p4t-number">#{player.number}</span></h1>
          <p className="p4t-profile-pos">{player.position} · <TeamLink teamId={team.id} name={team.name} onSelectTeam={onSelectTeam} /></p>
          {rank && (
            <div className="p4t-profile-rank">
              <Trophy size={13} /> {ordinalFr(rank.rank)} meilleur marqueur · {competitionLabel(rank.competitionId)}
            </div>
          )}
        </div>
      </div>
      <button className="p4t-share-btn p4t-compare-btn" onClick={() => onCompare(team.id, playerId)}><Users size={14} /> Comparer avec un autre joueur →</button>

      <div className="p4t-tile-row">
        <Tile icon={Users} value={career.matchesPlayed} unit="" label="Matchs joués" />
        <Tile icon={Clock} value={career.avgEffectiveMin} unit="min" label="Min/match" />
        <Tile icon={Target} value={career.ppg} unit="" label="Points/match" />
        <Tile icon={Layers} value={career.rpg} unit="" label="Rebonds/match" />
        <Tile icon={Share2} value={career.apg} unit="" label="Passes déc./match" />
        <Tile icon={TrendingUp} value={<span className={pmClass(career.avgPlusMinus)}>{formatPM(career.avgPlusMinus)}</span>} unit="" label="+/- moyen" />
      </div>

      <h2 className="p4t-section-title">Évolution</h2>
      <div className="p4t-chart-panel">
        <div className="p4t-chart-wrap">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="match" stroke="var(--ink-dim)" fontSize={11} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
              <YAxis stroke="var(--ink-dim)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 12 }}
                labelStyle={{ color: 'var(--ink)' }}
                labelFormatter={(label, payload) => (payload && payload[0] ? `vs ${payload[0].payload.opponent}` : label)}
              />
              <Line type="monotone" dataKey="Points" stroke="var(--red)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {seasonBests && (
        <>
          <SubsectionTitle>Records de la saison</SubsectionTitle>
          <div className="p4t-secondary-panel">
            <div className="p4t-tile-row p4t-tile-row-compact">
              <Tile variant="secondary" icon={Target} value={seasonBests.pts.pts} unit="" label="Points" sub={`vs ${seasonBests.pts.opponent}`} />
              <Tile variant="secondary" icon={Layers} value={seasonBests.reb.reb} unit="" label="Rebonds" sub={`vs ${seasonBests.reb.opponent}`} />
              <Tile variant="secondary" icon={Share2} value={seasonBests.ast.ast} unit="" label="Passes déc." sub={`vs ${seasonBests.ast.opponent}`} />
            </div>
          </div>
        </>
      )}

      <h2 className="p4t-section-title">Historique des matchs</h2>
      <div className="p4t-table-wrap">
        <table className="p4t-table">
          <thead>
            <tr>
              <th className="p4t-th-name">Match</th>
              <th>Score</th>
              <th>MIN</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>2PTS</th>
              <th>3PTS</th>
              <th>PF</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {history.slice().reverse().map((h) => (
              <tr key={h.matchId}>
                <td className="p4t-td-name">
                  <ResultBadge scoreFor={h.scoreFor} scoreAgainst={h.scoreAgainst} />
                  <span>vs <TeamLink teamId={h.opponentTeamId} name={h.opponent} onSelectTeam={onSelectTeam} /><span className="p4t-number">{formatDate(h.date)}</span></span>
                </td>
                <td>{h.scoreFor}–{h.scoreAgainst}</td>
                <td>{h.effectiveMin}</td>
                <td>{h.pts}</td>
                <td>{h.reb}</td>
                <td>{h.ast}</td>
                <td>{h.fg2Made}</td>
                <td>{h.fg3Made}</td>
                <td>{h.fouls}</td>
                <td className={pmClass(h.plusMinus)}>{formatPM(h.plusMinus)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="p4t-table-total-row">
              <td className="p4t-td-name">Total saison</td>
              <td>—</td>
              <td>{totals.min}</td>
              <td>{totals.pts}</td>
              <td>{totals.reb}</td>
              <td>{totals.ast}</td>
              <td>{totals.fg2}</td>
              <td>{totals.fg3}</td>
              <td>{totals.pf}</td>
              <td className={pmClass(totals.pm)}>{formatPM(totals.pm)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {showShare && (
        <ShareCardModal player={player} team={team} career={career} onClose={() => setShowShare(false)} />
      )}
    </>
  );
}

/* =========================================================================
   RECHERCHE (réutilisée sur l'accueil plateforme et dans un club)
   ========================================================================= */

function SearchBox({ variant = 'nav', placeholder = 'Chercher un joueur…', items, onSelect }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const results = query.trim().length > 0
    ? items.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6)
    : [];

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setFocused(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className={`p4t-search p4t-search-${variant}`} ref={ref}>
      <Search size={15} className="p4t-search-icon" />
      <input
        value={query}
        onFocus={() => setFocused(true)}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="p4t-search-input"
      />
      {query && (
        <button className="p4t-search-clear" onClick={() => setQuery('')}><X size={13} /></button>
      )}
      {focused && results.length > 0 && (
        <div className="p4t-search-dropdown">
          {results.map((item) => (
            <button
              key={`${item.kind || 'player'}-${item.id}`}
              className="p4t-search-result"
              onClick={() => { onSelect(item); setQuery(''); setFocused(false); }}
            >
              {item.kind === 'team'
                ? <ClubBadge teamId={item.id} name={item.name} size="p4t-avatar-sm" />
                : <span className="p4t-avatar p4t-avatar-sm">{initials(item.name).slice(0, 4)}</span>}
              <span>{item.name}</span>
              {item.kind === 'team' ? (
                <span className="p4t-search-result-team">{item.commune}</span>
              ) : (
                <>
                  {item.teamName && <span className="p4t-search-result-team">{item.teamName}</span>}
                  <span className="p4t-number">#{item.number}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {focused && query.trim().length > 0 && results.length === 0 && (
        <div className="p4t-search-dropdown">
          <div className="p4t-search-empty">Aucun résultat pour « {query} »</div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   PAGE D'ACCUEIL PLATEFORME — clubs, matchs et joueurs, tous confondus
   ========================================================================= */

function PlatformHome({ onSelectTeam, onOpenMatch, onOpenPlayer, onShowAllMatches, onShowAllPlayers, onShowAllLeaders, onShowAllHighlights, onShowAllClubs, onShowAllStandings, onShowAllCalendar, onShowAllRecords, onShowWeekDetail }) {
  const [leadersComp, setLeadersComp] = useState('r1-m');
  const [standingsComp, setStandingsComp] = useState('r1-m');

  const globalPlayers = useMemo(
    () => TEAMS.flatMap((t) => ROSTERS[t.id].map((p) => ({ ...p, teamId: t.id, teamName: t.name, competitionId: t.competitionId }))),
    []
  );

  const searchableItems = useMemo(
    () => [
      ...TEAMS.map((t) => ({ id: t.id, kind: 'team', name: t.name, commune: t.commune })),
      ...globalPlayers.map((p) => ({ ...p, kind: 'player' })),
    ],
    [globalPlayers]
  );

  const handleSearchSelect = (item) => {
    if (item.kind === 'team') onSelectTeam(item.id);
    else onOpenPlayer(item.teamId, item.id);
  };

  const leagueFeed = useMemo(() => buildLeagueFeed().slice(0, 3), []);
  const standings = useMemo(() => buildStandings(standingsComp), [standingsComp]);
  const potw = useMemo(() => getPlayerOfTheWeek(), []);
  const clubGroups = useMemo(() => {
    return COMPETITIONS.map((c) => ({
      competition: c,
      teams: TEAMS.filter((t) => t.competitionId === c.id).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.teams.length > 0);
  }, []);
  const seasonRecords = useMemo(() => getSeasonRecords(), []);

  const topScorers = useMemo(() => {
    return globalPlayers
      .filter((p) => p.competitionId === leadersComp)
      .map((p) => ({ player: p, teamName: p.teamName, ppg: getPlayerCareer(p.teamId, p.id).ppg }))
      .sort((a, b) => b.ppg - a.ppg)
      .slice(0, 3);
  }, [globalPlayers, leadersComp]);

  return (
    <>
      <div className="p4t-main">
        <section className="p4t-hero p4t-hero-first">
          <p className="p4t-eyebrow">Martinique</p>
          <h1 className="p4t-hero-title">Le basket antillais, chiffré à la seconde près.</h1>
          <p className="p4t-hero-sub">Le classement de la ligue, les stats de chaque joueur, les temps forts du week-end — tout le basket martiniquais, au même endroit.</p>
          <SearchBox variant="hero" placeholder="Chercher un joueur ou un club…" items={searchableItems} onSelect={handleSearchSelect} />
        </section>

        {potw && <>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Joueur de la semaine</h2>
        </div>
        <button className="p4t-potw-card" onClick={() => onShowWeekDetail(potw.fixture.id)}>
          <div className="p4t-potw-badge"><Star size={12} fill="currentColor" /> Meilleure perf du moment</div>
          <div className="p4t-potw-body">
            <span className="p4t-avatar p4t-avatar-lg p4t-potw-avatar">{initials(potw.player.name)}</span>
            <div className="p4t-potw-info">
              <div className="p4t-potw-name">{potw.player.name}<span className="p4t-number">#{potw.player.number}</span></div>
              <div className="p4t-potw-team">{teamName(potw.teamId)} · {potw.player.position}</div>
              <div className="p4t-potw-context">vs {potw.opponentName} · {formatDate(potw.fixture.date)}</div>
            </div>
            <div className="p4t-potw-stats">
              <div className="p4t-potw-stat"><span className="p4t-potw-stat-value">{potw.stat.pts}</span><span className="p4t-potw-stat-label">PTS</span></div>
              <div className="p4t-potw-stat"><span className="p4t-potw-stat-value">{potw.stat.reb}</span><span className="p4t-potw-stat-label">REB</span></div>
              <div className="p4t-potw-stat"><span className="p4t-potw-stat-value">{potw.stat.ast}</span><span className="p4t-potw-stat-label">AST</span></div>
            </div>
          </div>
        </button>
        </>}

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Leaders du championnat</h2>
          <span className="p4t-section-count">Points par match</span>
        </div>
        <CompetitionFilter value={leadersComp} onChange={setLeadersComp} />
        {topScorers.length > 0 ? (
          <Podium entries={topScorers} onOpenPlayer={onOpenPlayer} onSelectTeam={onSelectTeam} />
        ) : (
          <div className="p4t-comp-empty">Aucun club dans cette compétition pour l'instant.</div>
        )}
        <button className="p4t-see-all-link" onClick={onShowAllLeaders}>Voir le classement complet →</button>

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Records de la saison</h2>
          <span className="p4t-section-count">Meilleure perf par catégorie</span>
        </div>
        <div className="p4t-records-grid">
          {seasonRecords.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.key} className="p4t-record-card" onClick={() => onOpenPlayer(r.record.teamId, r.record.player.id)}>
                <div className="p4t-record-label"><Icon size={13} /> {r.label}</div>
                <div className="p4t-record-value">{r.record.value}</div>
                <div className="p4t-record-player">{r.record.player.name}</div>
                <div className="p4t-record-meta">{teamName(r.record.teamId)} · vs {r.record.opponent} · {formatDate(r.record.date)}</div>
              </button>
            );
          })}
        </div>
        <button className="p4t-see-all-link" onClick={onShowAllRecords}>Voir tous les records →</button>

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Highlights</h2>
          <span className="p4t-section-count">Saison 2025–2026</span>
        </div>
        <div className="p4t-highlight-row">
          {HIGHLIGHTS.map((h) => (
            <HighlightCard key={h.id} highlight={h} onOpenPlayer={onOpenPlayer} onSelectTeam={onSelectTeam} />
          ))}
        </div>
        <button className="p4t-see-all-link" onClick={onShowAllHighlights}>Voir tous les highlights →</button>

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Classement</h2>
          <span className="p4t-section-count"><span className="p4t-demo-tag">démo</span> {standings.length} clubs</span>
        </div>
        <CompetitionFilter value={standingsComp} onChange={setStandingsComp} />
        {standings.length > 0 ? (
          <StandingsTable standings={standings} onSelectTeam={onSelectTeam} />
        ) : (
          <div className="p4t-comp-empty">Aucun club dans cette compétition pour l'instant.</div>
        )}
        <button className="p4t-see-all-link" onClick={onShowAllStandings}>Voir le classement complet →</button>

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Derniers matchs</h2>
          <span className="p4t-section-count">Toutes équipes</span>
        </div>
        <div className="p4t-match-grid">
          {leagueFeed.map((item) => (
            <LeagueMatchCard key={item.id} item={item} onOpenMatch={onOpenMatch} onSelectTeam={onSelectTeam} onOpenPlayer={onOpenPlayer} />
          ))}
        </div>
        <button className="p4t-see-all-link" onClick={onShowAllMatches}>Voir les derniers matchs →</button>

        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Clubs</h2>
          <span className="p4t-section-count">{TEAMS.length} clubs</span>
        </div>
        {clubGroups.map((g) => (
          <div key={g.competition.id}>
            <h3 className="p4t-group-title">{g.competition.label} · {g.competition.gender}</h3>
            <div className="p4t-team-grid">
              {g.teams.map((t) => (
                <button key={t.id} className="p4t-team-card" onClick={() => onSelectTeam(t.id)}>
                  <ClubBadge teamId={t.id} name={t.name} size="p4t-avatar-lg" />
                  <div className="p4t-team-card-info">
                    <div className="p4t-team-card-name">{t.name}</div>
                    <div className="p4t-team-card-loc">{t.commune} · {t.region}</div>
                  </div>
                  <span className="p4t-team-card-tag p4t-team-card-tag-active">{LEAGUE[t.id].matches.length} matchs suivis</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Page neutre pour un match ouvert depuis un contexte "toutes équipes"
// (accueil, page Derniers matchs). Contrairement à MatchView (qui vit dans
// l'app d'un club et ne montre QUE son effectif), ici les deux équipes et
// leurs deux effectifs sont affichés à égalité — aucune des deux n'est "nous".
function MatchDetailView({ matchId, onBack, onOpenPlayer, onSelectTeam }) {
  const fixture = FIXTURES.find((f) => f.id === matchId);
  const homeMatch = LEAGUE[fixture.homeTeamId].matches.find((m) => m.id === matchId);
  const awayMatch = LEAGUE[fixture.awayTeamId].matches.find((m) => m.id === matchId);
  const [statsTeamId, setStatsTeamId] = useState(fixture.homeTeamId);

  const columns = [
    { key: 'effectiveMin', label: 'MIN' },
    { key: 'pts', label: 'PTS' },
    { key: 'reb', label: 'REB' },
    { key: 'ast', label: 'AST' },
    { key: 'fg2Made', label: '2PTS' },
    { key: 'fg3Made', label: '3PTS' },
    { key: 'fouls', label: 'PF' },
    { key: 'plusMinus', label: '+/-' },
  ];

  const statsMatch = statsTeamId === fixture.homeTeamId ? homeMatch : awayMatch;
  const statsRoster = ROSTERS[statsTeamId];
  const rows = useMemo(() => {
    return statsMatch.players
      .map((ps) => ({ ...ps, player: statsRoster.find((p) => p.id === ps.playerId) }))
      .sort((a, b) => b.pts - a.pts);
  }, [statsMatch, statsRoster]);

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-scorebug">
          <div className="p4t-scorebug-meta">{formatDate(fixture.date)} · {teamName(fixture.homeTeamId)} reçoit</div>
          <div className="p4t-scorebug-row">
            <span className="p4t-scorebug-team"><TeamLink teamId={fixture.homeTeamId} name={teamName(fixture.homeTeamId)} onSelectTeam={onSelectTeam} /></span>
            <span className="p4t-scorebug-score">{fixture.homeScore}<span className="p4t-score-sep">–</span>{fixture.awayScore}</span>
            <span className="p4t-scorebug-team p4t-scorebug-team-away"><TeamLink teamId={fixture.awayTeamId} name={teamName(fixture.awayTeamId)} onSelectTeam={onSelectTeam} /></span>
          </div>
        </div>

        <h2 className="p4t-section-title">Résumé</h2>
        <div className="p4t-table-wrap">
          <table className="p4t-table p4t-quarters-table">
            <thead>
              <tr>
                <th className="p4t-th-name">Équipe</th>
                <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p4t-td-name"><TeamLink teamId={fixture.homeTeamId} name={teamName(fixture.homeTeamId)} onSelectTeam={onSelectTeam} /></td>
                <td>{homeMatch.homeQuarters[0]}</td>
                <td>{homeMatch.homeQuarters[1]}</td>
                <td>{homeMatch.homeQuarters[2]}</td>
                <td>{homeMatch.homeQuarters[3]}</td>
                <td className="p4t-quarters-total">{fixture.homeScore}</td>
              </tr>
              <tr>
                <td className="p4t-td-name"><TeamLink teamId={fixture.awayTeamId} name={teamName(fixture.awayTeamId)} onSelectTeam={onSelectTeam} /></td>
                <td>{homeMatch.awayQuarters[0]}</td>
                <td>{homeMatch.awayQuarters[1]}</td>
                <td>{homeMatch.awayQuarters[2]}</td>
                <td>{homeMatch.awayQuarters[3]}</td>
                <td className="p4t-quarters-total">{fixture.awayScore}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="p4t-section-title">Stats individuelles</h2>
        <div className="p4t-comp-filter">
          <button className={`p4t-comp-filter-btn ${statsTeamId === fixture.homeTeamId ? 'p4t-comp-filter-btn-active' : ''}`} onClick={() => setStatsTeamId(fixture.homeTeamId)}>
            {teamName(fixture.homeTeamId)}
          </button>
          <button className={`p4t-comp-filter-btn ${statsTeamId === fixture.awayTeamId ? 'p4t-comp-filter-btn-active' : ''}`} onClick={() => setStatsTeamId(fixture.awayTeamId)}>
            {teamName(fixture.awayTeamId)}
          </button>
        </div>
        <div className="p4t-table-wrap">
          <table className="p4t-table">
            <thead>
              <tr>
                <th className="p4t-th-name">Joueur</th>
                {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId} onClick={() => onOpenPlayer(statsTeamId, r.playerId)} className="p4t-tr-click">
                  <td className="p4t-td-name">
                    <span className="p4t-avatar p4t-avatar-sm">{initials(r.player.name)}</span>
                    <span>{r.player.name}<span className="p4t-number">#{r.player.number}</span></span>
                  </td>
                  <td>{r.effectiveMin}</td>
                  <td>{r.pts}</td>
                  <td>{r.reb}</td>
                  <td>{r.ast}</td>
                  <td>{r.fg2Made}</td>
                  <td>{r.fg3Made}</td>
                  <td>{r.fouls}</td>
                  <td className={pmClass(r.plusMinus)}>{formatPM(r.plusMinus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Page dédiée "Joueur de la semaine" : temps forts, récap du match (quart-
// temps, lieu, équipes) et ligne de stats du joueur mis en avant — avec
// l'historique des semaines précédentes en dessous, cliquable pour changer
// de semaine sans quitter la page.
function PlayerOfWeekView({ matchId, onOpenPlayer, onSelectTeam, onBack }) {
  const [activeId, setActiveId] = useState(matchId);
  const history = useMemo(() => getWeeklyFeaturedHistory(), []);
  const featured = history.find((h) => h.fixture.id === activeId) || history[0];
  const { fixture, teamMatch, player, teamId, stat, opponentName } = featured;
  const highlights = HIGHLIGHTS.filter((h) => h.playerId === player.id);
  const venue = venueName(fixture.homeTeamId);

  const selectWeek = (id) => {
    setActiveId(id);
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>

        <div className="p4t-potw-badge"><Star size={12} fill="currentColor" /> Joueur de la semaine</div>
        <div className="p4t-profile-header">
          <span className="p4t-avatar p4t-avatar-lg p4t-potw-avatar">{initials(player.name)}</span>
          <div>
            <h1 className="p4t-profile-name">
              <PlayerLink teamId={teamId} playerId={player.id} name={player.name} onOpenPlayer={onOpenPlayer} />
              <span className="p4t-number">#{player.number}</span>
            </h1>
            <p className="p4t-profile-pos">{player.position} · <TeamLink teamId={teamId} name={teamName(teamId)} onSelectTeam={onSelectTeam} /></p>
          </div>
        </div>
        <button className="p4t-share-btn" onClick={() => onOpenPlayer(teamId, player.id)}>Voir la fiche complète du joueur →</button>

        {highlights.length > 0 && (
          <>
            <h2 className="p4t-section-title">Temps forts</h2>
            <div className="p4t-highlight-row">
              {highlights.map((h) => (
                <HighlightCard key={h.id} highlight={h} onOpenPlayer={onOpenPlayer} onSelectTeam={onSelectTeam} />
              ))}
            </div>
          </>
        )}

        <h2 className="p4t-section-title">Résumé du match</h2>
        <div className="p4t-scorebug">
          <div className="p4t-scorebug-meta">{formatDate(fixture.date)} · {venue}</div>
          <div className="p4t-scorebug-row">
            <span className="p4t-scorebug-team"><TeamLink teamId={fixture.homeTeamId} name={teamName(fixture.homeTeamId)} onSelectTeam={onSelectTeam} /></span>
            <span className="p4t-scorebug-score">{fixture.homeScore}<span className="p4t-score-sep">–</span>{fixture.awayScore}</span>
            <span className="p4t-scorebug-team p4t-scorebug-team-away"><TeamLink teamId={fixture.awayTeamId} name={teamName(fixture.awayTeamId)} onSelectTeam={onSelectTeam} /></span>
          </div>
        </div>
        <div className="p4t-table-wrap">
          <table className="p4t-table p4t-quarters-table">
            <thead>
              <tr>
                <th className="p4t-th-name">Équipe</th>
                <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p4t-td-name"><TeamLink teamId={fixture.homeTeamId} name={teamName(fixture.homeTeamId)} onSelectTeam={onSelectTeam} /></td>
                <td>{teamMatch.homeQuarters[0]}</td>
                <td>{teamMatch.homeQuarters[1]}</td>
                <td>{teamMatch.homeQuarters[2]}</td>
                <td>{teamMatch.homeQuarters[3]}</td>
                <td className="p4t-quarters-total">{fixture.homeScore}</td>
              </tr>
              <tr>
                <td className="p4t-td-name"><TeamLink teamId={fixture.awayTeamId} name={teamName(fixture.awayTeamId)} onSelectTeam={onSelectTeam} /></td>
                <td>{teamMatch.awayQuarters[0]}</td>
                <td>{teamMatch.awayQuarters[1]}</td>
                <td>{teamMatch.awayQuarters[2]}</td>
                <td>{teamMatch.awayQuarters[3]}</td>
                <td className="p4t-quarters-total">{fixture.awayScore}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="p4t-section-title">Ligne de stats — vs {opponentName}</h2>
        <div className="p4t-tile-row">
          <Tile icon={Clock} value={stat.effectiveMin} unit="min" label="Temps de jeu" />
          <Tile icon={Target} value={stat.pts} unit="" label="Points" />
          <Tile icon={Layers} value={stat.reb} unit="" label="Rebonds" />
          <Tile icon={Share2} value={stat.ast} unit="" label="Passes déc." />
          <Tile icon={TrendingUp} value={<span className={pmClass(stat.plusMinus)}>{formatPM(stat.plusMinus)}</span>} unit="" label="+/-" />
        </div>

        <h2 className="p4t-section-title">Anciens joueurs de la semaine</h2>
        <div className="p4t-leaderboard">
          {history.filter((h) => h.fixture.id !== featured.fixture.id).map((h) => (
            <button key={h.fixture.id} className="p4t-leader-row" onClick={() => selectWeek(h.fixture.id)}>
              <span className="p4t-avatar p4t-avatar-sm">{initials(h.player.name)}</span>
              <div className="p4t-leader-info">
                <div className="p4t-leader-name">
                  <PlayerLink teamId={h.teamId} playerId={h.player.id} name={h.player.name} onOpenPlayer={onOpenPlayer} />
                  <span className="p4t-number">#{h.player.number}</span>
                </div>
                <div className="p4t-leader-team">
                  <TeamLink teamId={h.teamId} name={teamName(h.teamId)} onSelectTeam={onSelectTeam} /> · {formatDate(h.fixture.date)}
                </div>
              </div>
              <div className="p4t-leader-value">{h.stat.pts}<span className="p4t-leader-unit">pts</span></div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// Calendrier complet, toutes équipes confondues, groupé par jour — matchs
// déjà joués (score, cliquable) et matchs à venir (juste l'affiche).
function AllCalendarView({ onOpenMatch, onSelectTeam, onBack }) {
  const grouped = useMemo(() => {
    const byDate = {};
    FIXTURES.forEach((f) => {
      if (!byDate[f.date]) byDate[f.date] = [];
      byDate[f.date].push(f);
    });
    return Object.keys(byDate).sort().map((date) => ({ date, fixtures: byDate[date] }));
  }, []);
  const playedCount = FIXTURES.filter((f) => f.homeScore != null).length;

  // Par défaut, on ouvre sur le premier jour qui contient un match à venir
  // (le plus utile à voir en arrivant), sinon le dernier jour joué.
  const defaultIndex = useMemo(() => {
    const idx = grouped.findIndex((g) => g.fixtures.some((f) => f.homeScore == null));
    return idx === -1 ? grouped.length - 1 : idx;
  }, [grouped]);
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const current = grouped[selectedIndex];

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Calendrier</h2>
          <span className="p4t-section-count">{playedCount} joués · {FIXTURES.length - playedCount} à venir</span>
        </div>

        <div className="p4t-cal-picker">
          <button
            className="p4t-cal-nav-btn"
            onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
            disabled={selectedIndex === 0}
            aria-label="Jour précédent"
          >
            <ChevronLeft size={16} />
          </button>
          <select
            className="p4t-cal-select"
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
          >
            {grouped.map((g, i) => (
              <option key={g.date} value={i}>
                {formatDate(g.date)} · {g.fixtures.length} match{g.fixtures.length > 1 ? 's' : ''}
              </option>
            ))}
          </select>
          <button
            className="p4t-cal-nav-btn"
            onClick={() => setSelectedIndex((i) => Math.min(grouped.length - 1, i + 1))}
            disabled={selectedIndex === grouped.length - 1}
            aria-label="Jour suivant"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className={`p4t-fixture-list${current.fixtures.some((f) => f.homeScore == null) ? ' p4t-fixture-list-pending' : ''}`}>
          {current.fixtures.some((f) => f.homeScore == null) && (
            <AsciiField
              className="p4t-pending-field"
              seeds={current.fixtures
                .filter((f) => f.homeScore == null)
                .slice(0, 6)
                .map((f) => `${teamName(f.homeTeamId)} VS ${teamName(f.awayTeamId)}`.toUpperCase())}
              alpha={0.4}
              speed={0.55}
              converge={0}
            />
          )}
          {current.fixtures.map((f) => {
            const played = f.homeScore != null;
            const competitionId = TEAMS.find((t) => t.id === f.homeTeamId).competitionId;
            const content = (
              <>
                <CompetitionMiniBadge competitionId={competitionId} />
                <span className="p4t-fixture-matchup">
                  <TeamLink teamId={f.homeTeamId} name={teamName(f.homeTeamId)} onSelectTeam={onSelectTeam} /> <span className="p4t-vs">vs</span>{' '}
                  <TeamLink teamId={f.awayTeamId} name={teamName(f.awayTeamId)} onSelectTeam={onSelectTeam} />
                </span>
                {played ? (
                  <span className="p4t-fixture-score">{f.homeScore} – {f.awayScore}</span>
                ) : (
                  <span className="p4t-fixture-tag">À venir</span>
                )}
              </>
            );
            return played ? (
              <button key={f.id} className="p4t-fixture-row p4t-fixture-row-click" onClick={() => onOpenMatch(f.homeTeamId, f.id)}>
                {content}
              </button>
            ) : (
              <div key={f.id} className="p4t-fixture-row">{content}</div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AllMatchesView({ onOpenMatch, onBack, onSelectTeam, onOpenPlayer }) {
  const feed = useMemo(() => buildLeagueFeed(), []);
  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Derniers matchs</h2>
          <span className="p4t-section-count">{feed.length} rencontres · toutes équipes</span>
        </div>
        <div className="p4t-match-grid">
          {feed.map((item) => (
            <LeagueMatchCard key={item.id} item={item} onOpenMatch={onOpenMatch} onSelectTeam={onSelectTeam} onOpenPlayer={onOpenPlayer} />
          ))}
        </div>
      </div>
    </>
  );
}

function AllPlayersView({ onOpenPlayer, onSelectTeam, onBack }) {
  const totalPlayers = TEAMS.reduce((sum, t) => sum + ROSTERS[t.id].length, 0);
  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Joueurs</h2>
          <span className="p4t-section-count">{totalPlayers} joueurs · {TEAMS.length} clubs</span>
        </div>
        {TEAMS.map((t) => (
          <div key={t.id}>
            <div className="p4t-group-head">
              <h3 className="p4t-group-title"><TeamLink teamId={t.id} name={t.name} onSelectTeam={onSelectTeam} /></h3>
              <span className="p4t-group-loc">{t.commune} · {t.region}</span>
            </div>
            <div className="p4t-players-grid">
              {ROSTERS[t.id].map((p) => {
                const career = getPlayerCareer(t.id, p.id);
                return (
                  <button key={p.id} className="p4t-player-card" onClick={() => onOpenPlayer(t.id, p.id)}>
                    <span className="p4t-avatar">{initials(p.name)}</span>
                    <div className="p4t-player-card-info">
                      <div className="p4t-player-card-name">{p.name}<span className="p4t-number">#{p.number}</span></div>
                      <div className="p4t-player-card-pos">{p.position}</div>
                    </div>
                    <div className="p4t-player-card-stats">
                      <div className="p4t-player-card-stat"><Target size={13} /> {career.ppg} pts/m.</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AllRecordsView({ onOpenPlayer, onSelectTeam, onBack }) {
  const [comp, setComp] = useState('r1-m');
  const individualRecords = useMemo(() => getSeasonRecords(comp), [comp]);
  const teamRecords = useMemo(() => getTeamSeasonRecords(comp), [comp]);
  const hasData = individualRecords.some((r) => r.record);

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Records de la saison</h2>
          <span className="p4t-section-count">{competitionLabel(comp)}</span>
        </div>
        <CompetitionFilter value={comp} onChange={setComp} />

        {!hasData ? (
          <div className="p4t-comp-empty">Aucun club dans cette compétition pour l'instant.</div>
        ) : (
          <>
            <h3 className="p4t-subsection-title">Records individuels</h3>
            <div className="p4t-records-grid">
              {individualRecords.map((r) => {
                const Icon = r.icon;
                return (
                  <button key={r.key} className="p4t-record-card" onClick={() => onOpenPlayer(r.record.teamId, r.record.player.id)}>
                    <div className="p4t-record-label"><Icon size={13} /> {r.label}</div>
                    <div className="p4t-record-value">{r.record.value}</div>
                    <div className="p4t-record-player">{r.record.player.name}</div>
                    <div className="p4t-record-meta">{teamName(r.record.teamId)} · vs {r.record.opponent} · {formatDate(r.record.date)}</div>
                  </button>
                );
              })}
            </div>

            <h3 className="p4t-subsection-title">Records d'équipe</h3>
            <div className="p4t-records-grid">
              {teamRecords.map((r) => {
                const Icon = r.icon;
                return (
                  <button key={r.key} className="p4t-record-card" onClick={() => onSelectTeam(r.record.teamId)}>
                    <div className="p4t-record-label"><Icon size={13} /> {r.label}</div>
                    <div className="p4t-record-value">{r.record.value}</div>
                    <div className="p4t-record-player">{teamName(r.record.teamId)}</div>
                    <div className="p4t-record-meta">vs {r.record.opponent} · {formatDate(r.record.date)}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function AllStandingsView({ onSelectTeam, onBack }) {
  const [comp, setComp] = useState('r1-m');
  const standings = useMemo(() => buildStandings(comp), [comp]);
  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Classement</h2>
          <span className="p4t-section-count"><span className="p4t-demo-tag">démo</span> {standings.length} clubs</span>
        </div>
        <CompetitionFilter value={comp} onChange={setComp} />
        {standings.length > 0 ? (
          <StandingsTable standings={standings} onSelectTeam={onSelectTeam} full />
        ) : (
          <div className="p4t-comp-empty">Aucun club dans cette compétition pour l'instant.</div>
        )}
      </div>
    </>
  );
}

function AllClubsView({ onSelectTeam, onBack }) {
  const groups = useMemo(() => {
    return COMPETITIONS.map((c) => ({
      competition: c,
      teams: TEAMS.filter((t) => t.competitionId === c.id).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.teams.length > 0);
  }, []);

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Clubs</h2>
          <span className="p4t-section-count">{TEAMS.length} clubs</span>
        </div>
        {groups.map((g) => (
          <div key={g.competition.id}>
            <h3 className="p4t-group-title">{g.competition.label} · {g.competition.gender}</h3>
            <div className="p4t-team-grid">
              {g.teams.map((t) => (
                <button key={t.id} className="p4t-team-card" onClick={() => onSelectTeam(t.id)}>
                  <ClubBadge teamId={t.id} name={t.name} size="p4t-avatar-lg" />
                  <div className="p4t-team-card-info">
                    <div className="p4t-team-card-name">{t.name}</div>
                    <div className="p4t-team-card-loc">{t.commune} · {t.region}</div>
                  </div>
                  <span className="p4t-team-card-tag p4t-team-card-tag-active">{LEAGUE[t.id].matches.length} matchs suivis</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AllLeadersView({ onOpenPlayer, onSelectTeam, onBack }) {
  const [sortKey, setSortKey] = useState('ppg');
  const [sortDir, setSortDir] = useState('desc');
  const [comp, setComp] = useState('r1-m');

  const globalPlayers = useMemo(
    () => TEAMS.flatMap((t) => ROSTERS[t.id].map((p) => ({ ...p, teamId: t.id, teamName: t.name, competitionId: t.competitionId }))),
    []
  );

  const rows = useMemo(() => {
    const withStats = globalPlayers
      .filter((p) => p.competitionId === comp)
      .map((p) => ({ player: p, teamName: p.teamName, ...getPlayerCareer(p.teamId, p.id) }));
    return withStats.sort((a, b) => (sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
  }, [globalPlayers, comp, sortKey, sortDir]);

  const columns = [
    { key: 'matchesPlayed', label: 'MJ' },
    { key: 'avgEffectiveMin', label: 'MIN' },
    { key: 'ppg', label: 'PTS' },
    { key: 'rpg', label: 'REB' },
    { key: 'apg', label: 'AST' },
    { key: 'avgPlusMinus', label: '+/-' },
  ];
  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Leaders du championnat</h2>
          <span className="p4t-section-count">{rows.length} joueurs</span>
        </div>
        <CompetitionFilter value={comp} onChange={setComp} />
        {rows.length === 0 ? (
          <div className="p4t-comp-empty">Aucun club dans cette compétition pour l'instant.</div>
        ) : (
        <div className="p4t-table-wrap">
          <table className="p4t-table">
            <thead>
              <tr>
                <th className="p4t-th-name">Joueur</th>
                <th className="p4t-th-name">Club</th>
                {columns.map((c) => (
                  <th key={c.key}>
                    <button className="p4t-sort-btn" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sortKey === c.key && (sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player.id} onClick={() => onOpenPlayer(r.player.teamId, r.player.id)} className="p4t-tr-click">
                  <td className="p4t-td-name">
                    <span className="p4t-avatar p4t-avatar-sm">{initials(r.player.name)}</span>
                    <span>{r.player.name}<span className="p4t-number">#{r.player.number}</span></span>
                  </td>
                  <td className="p4t-td-name"><TeamLink teamId={r.player.teamId} name={r.teamName} onSelectTeam={onSelectTeam} /></td>
                  <td>{r.matchesPlayed}</td>
                  <td>{r.avgEffectiveMin}</td>
                  <td>{r.ppg}</td>
                  <td>{r.rpg}</td>
                  <td>{r.apg}</td>
                  <td className={pmClass(r.avgPlusMinus)}>{formatPM(r.avgPlusMinus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </>
  );
}

function AllHighlightsView({ onOpenPlayer, onSelectTeam, onBack }) {
  const [filterType, setFilterType] = useState('all');
  const filtered = filterType === 'all' ? HIGHLIGHTS : HIGHLIGHTS.filter((h) => h.type === filterType);

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Highlights</h2>
          <span className="p4t-section-count">{filtered.length} action{filtered.length > 1 ? 's' : ''} · Saison 2025–2026</span>
        </div>
        <div className="p4t-comp-filter">
          <button className={`p4t-comp-filter-btn ${filterType === 'all' ? 'p4t-comp-filter-btn-active' : ''}`} onClick={() => setFilterType('all')}>
            Récents
          </button>
          {Object.entries(HIGHLIGHT_TYPES).map(([key, meta]) => (
            <button
              key={key}
              className={`p4t-comp-filter-btn ${filterType === key ? 'p4t-comp-filter-btn-active' : ''}`}
              onClick={() => setFilterType(key)}
            >
              {meta.label}
            </button>
          ))}
        </div>
        {filtered.length > 0 ? (
          <div className="p4t-highlight-grid">
            {filtered.map((h) => (
              <HighlightCard key={h.id} highlight={h} onOpenPlayer={onOpenPlayer} onSelectTeam={onSelectTeam} />
            ))}
          </div>
        ) : (
          <div className="p4t-comp-empty">Aucun highlight dans cette catégorie pour l'instant.</div>
        )}
      </div>
    </>
  );
}

function TeamComingSoon({ team, onBack }) {
  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Tous les clubs</button>
        <div className="p4t-comingsoon">
          <AsciiField
            className="p4t-comingsoon-field"
            seeds={[team.name.toUpperCase(), team.commune.toUpperCase(), team.venue.toUpperCase()]}
            alpha={0.42}
            speed={0.7}
            converge={0}
          />
          <ClubBadge teamId={team.id} name={team.name} size="p4t-avatar-lg" />
          <h1 className="p4t-comingsoon-title">{team.name}</h1>
          <p className="p4t-comingsoon-loc">{team.commune} · {team.region}</p>
          <p className="p4t-comingsoon-text">PIX4TEAM 2 n'est pas encore déployé chez ce club. Dès la première captation, les matchs, les stats d'équipe et les fiches joueurs apparaîtront ici automatiquement.</p>
        </div>
      </div>
    </>
  );
}

/* =========================================================================
   APP D'UN CLUB — nav Matchs/Joueurs + recherche, scopée à une équipe
   ========================================================================= */

// Comparaison de deux joueurs, n'importe lesquels sur la plateforme. Le
// joueur A arrive déjà choisi (depuis sa fiche), le joueur B se choisit via
// une recherche. La meilleure valeur de chaque ligne ressort en rouge.
function PlayerComparisonView({ teamIdA, playerIdA, onBack, onOpenPlayer, onSelectTeam }) {
  const [pickB, setPickB] = useState(null);

  const globalPlayers = useMemo(
    () => TEAMS.flatMap((t) => ROSTERS[t.id].map((p) => ({ ...p, teamId: t.id, teamName: t.name }))),
    []
  );
  const pickableForB = useMemo(
    () => globalPlayers.filter((p) => !(p.teamId === teamIdA && p.id === playerIdA)),
    [globalPlayers, teamIdA, playerIdA]
  );

  const playerA = ROSTERS[teamIdA].find((p) => p.id === playerIdA);
  const careerA = getPlayerCareer(teamIdA, playerIdA);
  const playerB = pickB ? ROSTERS[pickB.teamId].find((p) => p.id === pickB.playerId) : null;
  const careerB = pickB ? getPlayerCareer(pickB.teamId, pickB.playerId) : null;

  const rows = [
    { key: 'ppg', label: 'Points / match' },
    { key: 'rpg', label: 'Rebonds / match' },
    { key: 'apg', label: 'Passes déc. / match' },
    { key: 'avgPlusMinus', label: '+/- moyen', pm: true },
    { key: 'avgEffectiveMin', label: 'Minutes / match' },
    { key: 'matchesPlayed', label: 'Matchs joués' },
  ];

  return (
    <>
      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onBack}><ArrowLeft size={15} /> Accueil</button>
        <div className="p4t-section-head">
          <h2 className="p4t-section-title">Comparaison de joueurs</h2>
        </div>

        <div className="p4t-compare-heads">
          <div className="p4t-compare-head">
            <span className="p4t-avatar p4t-avatar-lg">{initials(playerA.name)}</span>
            <div className="p4t-compare-head-name">
              <PlayerLink teamId={teamIdA} playerId={playerA.id} name={playerA.name} onOpenPlayer={onOpenPlayer} />
            </div>
            <div className="p4t-compare-head-team">
              <TeamLink teamId={teamIdA} name={teamName(teamIdA)} onSelectTeam={onSelectTeam} />
            </div>
          </div>
          <div className="p4t-compare-vs">VS</div>
          <div className="p4t-compare-head">
            {playerB ? (
              <>
                <span className="p4t-avatar p4t-avatar-lg">{initials(playerB.name)}</span>
                <div className="p4t-compare-head-name">
                  <PlayerLink teamId={pickB.teamId} playerId={playerB.id} name={playerB.name} onOpenPlayer={onOpenPlayer} />
                </div>
                <div className="p4t-compare-head-team">
                  <TeamLink teamId={pickB.teamId} name={teamName(pickB.teamId)} onSelectTeam={onSelectTeam} />
                </div>
              </>
            ) : (
              <SearchBox
                variant="nav"
                placeholder="Choisir un adversaire…"
                items={pickableForB}
                onSelect={(p) => setPickB({ teamId: p.teamId, playerId: p.id })}
              />
            )}
          </div>
        </div>

        {playerB && (
          <div className="p4t-compare-table">
            {rows.map((r) => {
              const va = careerA[r.key];
              const vb = careerB[r.key];
              return (
                <div className="p4t-compare-row" key={r.key}>
                  <span className={`p4t-compare-val ${va > vb ? 'p4t-compare-best' : ''}`}>{r.pm ? formatPM(va) : va}</span>
                  <span className="p4t-compare-label">{r.label}</span>
                  <span className={`p4t-compare-val ${vb > va ? 'p4t-compare-best' : ''}`}>{r.pm ? formatPM(vb) : vb}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function TeamApp({ team, initialView, initialMatchId, initialPlayerId, onSelectTeam, onCompare, onGoHome, onOpenAnyPlayer }) {
  const [view, setView] = useState(initialView || 'matches');
  const [selectedMatchId, setSelectedMatchId] = useState(initialMatchId || null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(initialPlayerId || null);

  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const openMatch = (id) => { setSelectedMatchId(id); setView('match'); };
  const openPlayer = (id) => { setSelectedPlayerId(id); setView('player'); };

  return (
    <>
      <div className="p4t-subnav">
        <span className="p4t-subnav-team">{team.name}</span>
        <div className="p4t-nav-tabs">
          <button className={`p4t-tab ${view === 'matches' || view === 'match' ? 'p4t-tab-active' : ''}`} onClick={() => setView('matches')}>Matchs</button>
          <button className={`p4t-tab ${view === 'calendar' ? 'p4t-tab-active' : ''}`} onClick={() => setView('calendar')}>Calendrier</button>
          <button className={`p4t-tab ${view === 'players' || view === 'player' ? 'p4t-tab-active' : ''}`} onClick={() => setView('players')}>Joueurs</button>
        </div>
        <SearchBox variant="nav" items={ROSTERS[team.id]} onSelect={(p) => openPlayer(p.id)} />
      </div>

      <div className="p4t-main">
        <button className="p4t-back-btn" onClick={onGoHome}><ArrowLeft size={15} /> Accueil</button>
        {view === 'matches' && <MatchesView team={team} onOpenMatch={openMatch} onSelectTeam={onSelectTeam} onOpenPlayer={openPlayer} />}
        {view === 'calendar' && <TeamCalendarView team={team} onOpenMatch={openMatch} onSelectTeam={onSelectTeam} onOpenPlayer={openPlayer} />}
        {view === 'match' && <MatchView team={team} matchId={selectedMatchId} onBack={() => setView('matches')} onOpenPlayer={onOpenAnyPlayer} onSelectTeam={onSelectTeam} />}
        {view === 'players' && <PlayersView team={team} onOpenPlayer={openPlayer} />}
        {view === 'player' && <PlayerView team={team} playerId={selectedPlayerId} onBack={() => setView('players')} onSelectTeam={onSelectTeam} onCompare={onCompare} />}
      </div>
    </>
  );
}

/* =========================================================================
   APP — routage plateforme (accueil) ↔ club sélectionné
   ========================================================================= */

export default function App() {
  const [screen, setScreen] = useState('home'); // 'home' | 'team' | 'matchDetail' | 'weekDetail' | 'allMatches' | 'allPlayers' | 'allClubs' | 'allLeaders' | 'allHighlights' | 'allStandings' | 'allCalendar' | 'allRecords' | 'compare'
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [teamEntry, setTeamEntry] = useState({ view: 'matches', matchId: null, playerId: null });
  const [neutralMatchId, setNeutralMatchId] = useState(null);
  const [weekMatchId, setWeekMatchId] = useState(null);
  const [compareA, setCompareA] = useState(null);

  useEffect(() => { window.scrollTo(0, 0); }, [screen, selectedTeamId, neutralMatchId]);

  const goHome = () => setScreen('home');
  const showAllMatches = () => setScreen('allMatches');
  const showAllPlayers = () => setScreen('allPlayers');
  const showAllClubs = () => setScreen('allClubs');
  const showAllStandings = () => setScreen('allStandings');
  const showAllCalendar = () => setScreen('allCalendar');
  const showAllRecords = () => setScreen('allRecords');
  const showCompare = (teamId, playerId) => {
    setCompareA({ teamId, playerId });
    setScreen('compare');
  };
  const showWeekDetail = (matchId) => {
    setWeekMatchId(matchId);
    setScreen('weekDetail');
  };
  const showAllLeaders = () => setScreen('allLeaders');
  const showAllHighlights = () => setScreen('allHighlights');
  const selectTeam = (teamId) => {
    setSelectedTeamId(teamId);
    setTeamEntry({ view: 'matches', matchId: null, playerId: null });
    setScreen('team');
  };
  // Ouvre un match depuis un contexte "toutes équipes" (accueil, page Derniers
  // matchs) : ce match n'appartient à aucun des deux clubs en particulier,
  // donc on va sur une page neutre plutôt que dans l'app d'un club.
  const openMatchFromHome = (_teamId, matchId) => {
    setNeutralMatchId(matchId);
    setScreen('matchDetail');
  };
  const openPlayerFromHome = (teamId, playerId) => {
    setSelectedTeamId(teamId);
    setTeamEntry({ view: 'player', matchId: null, playerId });
    setScreen('team');
  };

  const selectedTeam = TEAMS.find((t) => t.id === selectedTeamId);

  const globalPlayers = useMemo(
    () => TEAMS.flatMap((t) => ROSTERS[t.id].map((p) => ({ ...p, teamId: t.id, teamName: t.name }))),
    []
  );
  const globalSearchableItems = useMemo(
    () => [
      ...TEAMS.map((t) => ({ id: t.id, kind: 'team', name: t.name, commune: t.commune })),
      ...globalPlayers.map((p) => ({ ...p, kind: 'player' })),
    ],
    [globalPlayers]
  );
  const handleGlobalSearchSelect = (item) => {
    if (item.kind === 'team') selectTeam(item.id);
    else openPlayerFromHome(item.teamId, item.id);
  };

  return (
    <div className="p4t-app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');

        html, body { background: #120E0A; }
        /* Les jetons vivent sur :root et non sur .p4t-app, pour que le fond
           de page suive le theme et que le choix se fasse par un seul
           attribut data-theme sur documentElement. */
        :root {
          --bg: #120E0A;
          --panel: rgba(28,22,17,.58);
          --panel-raised: rgba(38,32,26,.66);
          --line: #3A3128;
          --ink: #F6F0E4;
          --ink-dim: #A2937E;
          --amber: #FFB020;
          --teal: #2FA8A0;
          --red: #E0523C;
          --green: #4FB56A;
          --heat: #FFB020;
          --shadow: rgba(0,0,0,.45);
          --nav-bg: rgba(18,14,10,0.92);
          --demo-bg: rgba(38,20,14,0.92);
          --demo-line: rgba(224,82,60,0.38);
          --font-display: 'Anton', sans-serif;
          --font-body: 'Manrope', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        /* Theme clair : le meme parquet vu de jour. L'ambre est assombri,
           sinon il ne passe pas le contraste sur du papier. */
        :root[data-theme="light"] {
          --bg: #FBF7EF;
          --panel: rgba(243,237,225,.62);
          --panel-raised: rgba(233,225,209,.7);
          --line: #DCD2BE;
          --ink: #1A140D;
          --ink-dim: #665738;
          --amber: #A96A00;
          --teal: #1B7A72;
          --red: #BF3B24;
          --green: #2E7D46;
          --heat: #A96A00;
          --shadow: rgba(60,45,25,.16);
          --nav-bg: rgba(251,247,239,0.92);
          --demo-bg: rgba(252,238,232,0.94);
          --demo-line: rgba(191,59,36,0.32);
        }
        html, body { background: var(--bg); }
        .p4t-app {
          background: transparent;
          position: relative; z-index: 1;
          color: var(--ink);
          font-family: var(--font-body);
          min-height: 100%;
          border-radius: 12px;
          /* Surtout pas overflow:hidden ici : cela cree un conteneur de
             defilement et neutralise position:sticky a l'interieur, ce qui
             casse le heros scrube. overflow-x:clip decoupe sans creer ce
             conteneur. (Le CSS vit dans un template literal : pas de
             backtick dans ces commentaires.) */
          overflow-x: clip;
        }
        .p4t-app * { box-sizing: border-box; }
        .p4t-app button { font-family: inherit; cursor: pointer; color: inherit; }
        .p4t-app :focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

        .p4t-pm-pos { color: var(--green); }
        .p4t-pm-neg { color: var(--heat); }
        .p4t-pm-flat { color: var(--ink-dim); }

        .p4t-nav {
          display: flex; align-items: center; gap: 20px;
          padding: 14px 24px; border-bottom: 1px solid var(--line);
          background: var(--nav-bg); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 20;
        }
        .p4t-home-btn {
          background: none; border: none; color: var(--ink-dim); display: flex; align-items: center;
          justify-content: center; padding: 6px; border-radius: 7px;
        }
        .p4t-home-btn:hover { color: var(--ink); background: var(--panel); }
        /* Bandeau de demonstration: colle sous la nav, jamais masque, lisible
           dans les deux themes. Il utilise la couleur d alerte, la seule du
           systeme, et c est le bon endroit pour la depenser. */
        .p4t-demo-banner {
          position: sticky; top: 61px; z-index: 19;
          padding: 9px 24px; font-size: 12.5px; line-height: 1.45;
          color: var(--ink); background: var(--demo-bg);
          border-bottom: 1px solid var(--demo-line);
          backdrop-filter: blur(10px);
        }
        .p4t-demo-banner strong { color: var(--red); letter-spacing: .04em; }
        /* L etat "donnees reelles" n est pas un avertissement: il ne prend pas
           la couleur d alerte, qui doit rester reservee au fabrique. */
        .p4t-demo-banner-reel { background: var(--panel); border-bottom-color: var(--line); }
        .p4t-demo-banner-reel strong { color: var(--teal); }
        .p4t-demo-tag {
          display: inline-block; font-family: var(--font-mono);
          font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em;
          color: var(--red); border: 1px solid var(--red); border-radius: 4px;
          padding: 0 5px; margin-right: 7px; vertical-align: 1px;
        }
        @media (max-width: 700px) {
          .p4t-demo-banner { padding: 8px 16px; font-size: 11.5px; }
        }

        .p4t-theme-btn {
          flex: none; display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 9px;
          background: var(--panel); border: 1px solid var(--line); color: var(--ink-dim);
          transition: color .15s, border-color .15s, background .15s;
        }
        .p4t-theme-btn:hover { color: var(--amber); border-color: var(--amber); }

        .p4t-nav-brand {
          font-family: var(--font-display); font-weight: 600; letter-spacing: 0.04em;
          font-size: 17px; display: flex; align-items: center; gap: 8px; margin-right: auto; flex-shrink: 0;
        }
        .p4t-nav-brand-click { cursor: pointer; }
        .p4t-nav-brand-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); }
        .p4t-nav-team-sep { color: var(--ink-dim); margin: 0 2px; opacity: 0.5; font-weight: 400; }
        .p4t-nav-team-name { color: var(--ink-dim); font-weight: 500; font-size: 14px; letter-spacing: 0; }
        .p4t-nav-tabs {
          display: flex; gap: 4px; overflow-x: auto; min-width: 0; flex-shrink: 1;
          scrollbar-width: none; -ms-overflow-style: none;
        }
        .p4t-nav-tabs::-webkit-scrollbar { display: none; }
        .p4t-subnav {
          display: flex; align-items: center; gap: 20px; padding: 12px 24px; border-bottom: 1px solid var(--line);
          background: var(--panel); flex-wrap: wrap;
        }
        .p4t-subnav-team {
          font-family: var(--font-display); font-weight: 600; font-size: 14px; color: var(--ink-dim);
          margin-right: auto; white-space: nowrap;
        }
        .p4t-tab {
          background: none; border: none; color: var(--ink-dim); font-size: 13px; font-weight: 500;
          padding: 7px 12px; border-radius: 7px; transition: all .15s; flex-shrink: 0; white-space: nowrap;
        }
        .p4t-tab:hover { color: var(--ink); background: var(--panel); }
        .p4t-tab-active { color: var(--bg); background: var(--red); }
        .p4t-tab-active:hover { color: var(--bg); background: var(--red); }

        .p4t-search { position: relative; display: flex; align-items: center; }
        .p4t-search-nav { width: 220px; }
        .p4t-search-hero { width: 100%; max-width: 420px; margin-top: 18px; }
        .p4t-search-icon { position: absolute; left: 11px; color: var(--ink-dim); pointer-events: none; }
        .p4t-search-input {
          width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
          color: var(--ink); font-size: 13px; padding: 8px 30px 8px 32px; font-family: var(--font-body);
        }
        .p4t-search-hero .p4t-search-input { padding: 12px 34px; font-size: 14px; border-radius: 10px; }
        .p4t-search-input::placeholder { color: var(--ink-dim); }
        .p4t-search-clear { position: absolute; right: 9px; background: none; border: none; color: var(--ink-dim); display: flex; }
        .p4t-search-dropdown {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--panel-raised);
          border: 1px solid var(--line); border-radius: 9px; overflow: hidden; z-index: 30;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        }
        .p4t-search-result {
          width: 100%; display: flex; align-items: center; gap: 9px; padding: 9px 12px;
          background: none; border: none; color: var(--ink); font-size: 13px; text-align: left;
        }
        .p4t-search-result:hover { background: var(--panel); }
        .p4t-search-result-team { color: var(--ink-dim); font-size: 11px; }
        .p4t-search-result .p4t-number { margin-left: auto; }
        .p4t-search-empty { padding: 12px; font-size: 12.5px; color: var(--ink-dim); }

        .p4t-main { padding: 26px 24px 48px; max-width: 980px; margin: 0 auto; }

        .p4t-eyebrow { font-size: 12px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--red); font-weight: 600; margin: 0 0 10px; }
        .p4t-hero {
          padding: 44px 20px 36px; border-bottom: 1px solid var(--line); margin-bottom: 40px;
          text-align: center; display: flex; flex-direction: column; align-items: center;
        }
        .p4t-hero-title { font-family: var(--font-display); font-size: 34px; font-weight: 600; line-height: 1.15; margin: 0 0 10px; max-width: 620px; }
        .p4t-hero-sub { color: var(--ink-dim); font-size: 14.5px; max-width: 480px; line-height: 1.55; margin: 0 0 4px; }

        .p4t-hero-form { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
        .p4t-hero-form-label { font-size: 11px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; }
        .p4t-form-row { display: flex; gap: 3px; }
        .p4t-form-badge {
          width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
        }
        .p4t-form-win { background: rgba(47,168,160,0.15); color: var(--green); }
        .p4t-form-loss { background: rgba(255,176,32,0.15); color: var(--red); }
        .p4t-form-empty { color: var(--ink-dim); font-size: 12px; }

        .p4t-comp-badge {
          display: inline-flex; align-items: center; font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.03em; padding: 3px 8px; border-radius: 5px; border: 1px solid var(--line);
          color: var(--ink-dim); white-space: nowrap; margin-top: 4px;
        }
        .p4t-comp-badge-r1-m { color: var(--red); border-color: rgba(255,176,32,0.35); background: rgba(255,176,32,0.07); }
        .p4t-comp-badge-r2-m { color: var(--ink-dim); border-color: var(--line); }
        .p4t-comp-badge-r1-f { color: var(--green); border-color: rgba(47,168,160,0.35); background: rgba(47,168,160,0.07); }

        .p4t-comp-filter { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 16px; }
        .p4t-comp-filter-btn {
          background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px;
          font-size: 12.5px; font-weight: 600; color: var(--ink-dim); display: flex; align-items: baseline; gap: 5px;
        }
        .p4t-comp-filter-gender { font-size: 10.5px; font-weight: 400; opacity: 0.8; }
        .p4t-comp-filter-btn:hover { border-color: var(--red); }
        .p4t-comp-filter-btn-active { background: var(--red); border-color: var(--red); color: #fff; }
        .p4t-comp-filter-btn-active:hover { border-color: var(--red); }
        .p4t-comp-empty { color: var(--ink-dim); font-size: 13px; padding: 24px; text-align: center; background: var(--panel); border: 1px dashed var(--line); border-radius: 12px; }

        .p4t-comp-mini {
          font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 0 6px; height: 20px;
          border-radius: 5px; display: inline-flex; align-items: center; justify-content: center;
        }
        .p4t-comp-mini-r1-m { background: rgba(255,176,32,0.15); color: var(--red); }
        .p4t-comp-mini-r2-m { background: var(--panel-raised); color: var(--ink-dim); border: 1px solid var(--line); }
        .p4t-comp-mini-r1-f { background: rgba(47,168,160,0.15); color: var(--green); }

        .p4t-records-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
        .p4t-record-card {
          text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
          padding: 14px 16px; transition: border-color .15s, transform .15s;
        }
        .p4t-record-card:hover { border-color: var(--red); transform: translateY(-2px); }
        .p4t-record-label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .p4t-record-value { font-family: var(--font-mono); font-size: 32px; font-weight: 700; color: var(--red); line-height: 1; }
        .p4t-record-player { font-size: 13px; font-weight: 600; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p4t-record-meta { font-size: 10.5px; color: var(--ink-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .p4t-compare-heads { display: flex; align-items: flex-start; gap: 12px; margin: 4px 0 24px; }
        .p4t-compare-head { flex: 1; text-align: center; min-width: 0; }
        .p4t-compare-head-name { font-size: 14px; font-weight: 600; margin-top: 8px; }
        .p4t-compare-head-team { font-size: 11px; color: var(--ink-dim); margin-top: 2px; }
        .p4t-compare-head .p4t-search { text-align: left; margin-top: 4px; }
        .p4t-compare-vs { font-family: var(--font-display); font-weight: 700; font-size: 13px; color: var(--ink-dim); flex-shrink: 0; padding-top: 20px; }
        .p4t-compare-table { display: flex; flex-direction: column; gap: 6px; }
        .p4t-compare-row {
          display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;
          background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px;
        }
        .p4t-compare-val { font-family: var(--font-mono); font-size: 18px; font-weight: 700; color: var(--ink-dim); }
        .p4t-compare-row .p4t-compare-val:first-child { text-align: right; }
        .p4t-compare-row .p4t-compare-val:last-child { text-align: left; }
        .p4t-compare-best { color: var(--red); }
        .p4t-compare-label { font-size: 10.5px; color: var(--ink-dim); text-align: center; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }

        .p4t-section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 30px 0 14px; }
        .p4t-group-head { display: flex; align-items: baseline; justify-content: space-between; margin: 0; }
        .p4t-group-title {
          font-family: var(--font-display); font-size: 14px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.05em; color: var(--red); margin: 34px 0 12px;
        }
        .p4t-group-loc { font-size: 11px; color: var(--ink-dim); }

        .p4t-fixture-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
        .p4t-fixture-row {
          display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
          background: var(--panel); border: 1px dashed var(--line); border-radius: 10px;
          padding: 10px 14px; font-family: inherit; flex-wrap: wrap;
        }
        .p4t-fixture-row-click { cursor: pointer; transition: border-color .15s; }
        .p4t-fixture-row-click:hover { border-color: var(--red); }
        .p4t-fixture-date { font-size: 11px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.03em; min-width: 84px; }
        .p4t-fixture-matchup { flex: 1; font-size: 13px; min-width: 160px; }
        .p4t-fixture-score { font-family: var(--font-mono); font-weight: 700; font-size: 14px; color: var(--ink); }
        .p4t-fixture-tag {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--red); background: rgba(255,176,32,0.1); padding: 3px 8px; border-radius: 5px;
        }

        .p4t-cal-picker { display: flex; align-items: center; gap: 10px; margin: 4px 0 18px; }
        .p4t-cal-nav-btn {
          background: var(--panel); border: 1px solid var(--line); border-radius: 8px; width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center; color: var(--ink-dim); flex-shrink: 0;
        }
        .p4t-cal-nav-btn:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
        .p4t-cal-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .p4t-cal-select {
          flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
          color: var(--ink); font-size: 14px; padding: 9px 12px; font-family: inherit; min-width: 0;
        }
        .p4t-section-title {
          font-family: var(--font-display); font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em;
          font-weight: 600; color: var(--ink); margin: 30px 0 14px; display: flex; align-items: center; gap: 6px;
        }
        .p4t-subsection-title {
          font-family: var(--font-body); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-dim); display: flex; align-items: center; gap: 6px; margin: 22px 0 10px; font-weight: 600;
        }
        .p4t-section-count { color: var(--ink-dim); font-size: 12.5px; }

        .p4t-team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
        .p4t-team-card {
          display: flex; align-items: center; gap: 12px; text-align: left; background: var(--panel);
          border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; transition: border-color .15s, transform .15s;
        }
        .p4t-team-card:hover { border-color: var(--red); transform: translateY(-2px); }
        .p4t-team-card-info { flex: 1; min-width: 0; }
        .p4t-team-card-name { font-size: 14px; font-weight: 600; line-height: 1.25; }
        .p4t-team-card-loc { font-size: 11.5px; color: var(--ink-dim); margin-top: 2px; }
        .p4t-team-card-tag { font-size: 10.5px; color: var(--ink-dim); white-space: nowrap; flex-shrink: 0; }
        .p4t-team-card-tag-active { color: var(--red); font-weight: 600; }

        .p4t-see-all-link { background: none; border: none; color: var(--ink-dim); font-size: 13px; font-weight: 500; margin-top: 14px; padding: 0; }
        .p4t-see-all-link:hover { color: var(--red); }

        .p4t-leaderboard { display: flex; flex-direction: column; gap: 8px; }

        .p4t-potw-card {
          display: block; width: 100%; text-align: left; background: var(--panel); border: 1px solid var(--line);
          border-left: 4px solid var(--red); border-radius: 14px; padding: 18px 20px; transition: transform .15s, border-color .15s;
        }
        .p4t-potw-card:hover { transform: translateY(-2px); }
        .p4t-potw-badge {
          display: flex; align-items: center; gap: 5px; color: var(--red); font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 14px;
        }
        .p4t-potw-body { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .p4t-potw-avatar { border-color: var(--red); color: var(--red); }
        .p4t-potw-info { flex: 1; min-width: 150px; }
        .p4t-potw-name { font-size: 17px; font-weight: 600; }
        .p4t-potw-team { font-size: 12px; color: var(--ink-dim); margin-top: 2px; }
        .p4t-potw-context { font-size: 11.5px; color: var(--ink-dim); margin-top: 2px; }
        .p4t-potw-stats { display: flex; gap: 18px; }
        .p4t-potw-stat { text-align: center; }
        .p4t-potw-stat-value { display: block; font-family: var(--font-mono); font-weight: 700; font-size: 22px; color: var(--ink); }
        .p4t-potw-stat-label { font-size: 9.5px; color: var(--ink-dim); letter-spacing: 0.04em; }

        .p4t-podium { display: flex; align-items: flex-end; justify-content: center; gap: 10px; margin: 6px 0 4px; }
        .p4t-podium-slot {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          background: none; border: none; flex: 1 1 0; min-width: 0; max-width: 160px;
        }
        .p4t-podium-card {
          background: var(--panel); border: 1px solid var(--line); border-radius: 12px 12px 0 0;
          border-bottom: none; padding: 12px 8px 14px; width: 100%; position: relative; z-index: 2;
          transition: border-color .15s, transform .15s;
        }
        .p4t-podium-slot:hover .p4t-podium-card { border-color: var(--red); transform: translateY(-2px); }
        .p4t-podium-name { font-size: 12.5px; font-weight: 600; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .p4t-podium-team { font-size: 10px; color: var(--ink-dim); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .p4t-podium-ppg { font-family: var(--font-mono); font-weight: 700; font-size: 18px; margin-top: 6px; color: var(--ink); }
        .p4t-podium-ppg-unit { font-size: 10px; color: var(--ink-dim); font-weight: 400; margin-left: 2px; }
        .p4t-podium-riser {
          width: 100%; border-radius: 0 0 8px 8px; display: flex; align-items: flex-start; justify-content: center;
          padding-top: 6px; font-family: var(--font-display); font-weight: 700; font-size: 20px;
          border: 1px solid var(--line); border-top: 1px dashed var(--line); position: relative; z-index: 1;
        }
        .p4t-podium-1 .p4t-podium-riser { height: 60px; background: linear-gradient(0deg, rgba(255,176,32,0.28), rgba(255,176,32,0.06)); color: var(--amber); border-color: rgba(255,176,32,0.45); }
        .p4t-podium-2 .p4t-podium-riser { height: 40px; background: linear-gradient(0deg, rgba(162,147,126,0.18), rgba(162,147,126,0.04)); color: var(--ink-dim); border-color: var(--line); }
        .p4t-podium-3 .p4t-podium-riser { height: 26px; background: linear-gradient(0deg, rgba(22,20,18,0.14), rgba(22,20,18,0.03)); color: var(--ink); border-color: rgba(22,20,18,0.25); }
        .p4t-podium-1 .p4t-avatar { border-color: var(--amber); color: var(--amber); }
        .p4t-podium-2 .p4t-avatar { border-color: var(--teal); color: var(--teal); }
        .p4t-podium-3 .p4t-avatar { border-color: var(--ink); color: var(--ink); }

        .p4t-highlight-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x proximity; }
        .p4t-highlight-row::-webkit-scrollbar { height: 6px; }
        .p4t-highlight-row::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
        .p4t-highlight-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
        .p4t-highlight-card {
          flex: 0 0 190px; scroll-snap-align: start; text-align: left; background: var(--panel);
          border: 1px solid var(--line); border-radius: 12px; overflow: hidden; transition: border-color .15s, transform .15s;
        }
        .p4t-highlight-card:hover { border-color: var(--red); transform: translateY(-2px); }
        .p4t-highlight-thumb { position: relative; height: 106px; display: flex; align-items: center; justify-content: center; }
        .p4t-highlight-thumb-dunk  { background: linear-gradient(135deg, rgba(255,176,32,0.4), rgba(255,176,32,0.18)); }
        .p4t-highlight-thumb-3pts  { background: linear-gradient(135deg, rgba(47,168,160,0.32), rgba(255,176,32,0.16)); }
        .p4t-highlight-thumb-block { background: linear-gradient(135deg, rgba(28,22,17,0.96), rgba(47,168,160,0.22)); }
        .p4t-highlight-play {
          width: 38px; height: 38px; border-radius: 50%; background: rgba(18,22,29,0.55);
          border: 1.5px solid rgba(246,240,228,0.55); color: var(--ink); display: flex; align-items: center;
          justify-content: center; padding-left: 3px;
        }
        .p4t-highlight-badge {
          position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 4px;
          background: rgba(18,14,10,0.78); border-radius: 5px; padding: 3px 7px; font-size: 10px;
          font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink);
        }
        .p4t-highlight-duration {
          position: absolute; bottom: 8px; right: 8px; background: rgba(18,22,29,0.75); border-radius: 5px;
          padding: 2px 6px; font-family: var(--font-mono); font-size: 10.5px; color: var(--ink);
        }
        .p4t-highlight-share-btn {
          position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 50%;
          background: rgba(18,14,10,0.78); color: var(--ink); display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }
        .p4t-highlight-share-btn:hover { background: rgba(18,22,29,0.9); }
        .p4t-highlight-info { padding: 10px 12px 12px; }
        .p4t-highlight-player { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p4t-highlight-meta { font-size: 10.5px; color: var(--ink-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p4t-leader-row {
          display: flex; align-items: center; gap: 12px; text-align: left; background: var(--panel);
          border: 1px solid var(--line); border-radius: 11px; padding: 10px 14px; transition: border-color .15s;
        }
        .p4t-leader-row:hover { border-color: var(--red); }
        .p4t-leader-rank {
          width: 22px; height: 22px; border-radius: 6px; background: var(--panel-raised); border: 1px solid var(--line);
          color: var(--ink-dim); font-family: var(--font-mono); font-size: 11px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .p4t-leader-rank-first { color: var(--bg); background: var(--red); border-color: var(--red); }
        .p4t-leader-info { flex: 1; min-width: 0; }
        .p4t-leader-name { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p4t-leader-team { font-size: 11px; color: var(--ink-dim); margin-top: 1px; }
        .p4t-leader-value { font-family: var(--font-mono); font-size: 18px; font-weight: 700; color: var(--red); flex-shrink: 0; display: flex; align-items: baseline; gap: 3px; }
        .p4t-leader-unit { font-size: 10.5px; color: var(--ink-dim); font-weight: 400; }

        /* La liste des matchs a venir est la seule zone du site ou la donnee
           n'existe pas encore. On y fait tourner le champ ASCII : le score
           n'est pas absent, il n'a pas encore converge. */
        .p4t-fixture-list-pending { position: relative; isolation: isolate; }
        .p4t-pending-field {
          /* Un canvas est un element remplace : des inset opposes ne l'etirent
             pas, il garde sa taille intrinseque 300x150. Il faut donc lui
             donner width et height explicitement. */
          position: absolute; left: -10px; top: -34px; z-index: -1; pointer-events: none;
          width: calc(100% + 20px); height: calc(100% + 68px);
          -webkit-mask-image: linear-gradient(to right, transparent, #000 22%, #000 78%, transparent);
          mask-image: linear-gradient(to right, transparent, #000 22%, #000 78%, transparent);
        }
        .p4t-fixture-list-pending .p4t-fixture-row { position: relative; }

        .p4t-comingsoon {
          text-align: center; padding: 64px 20px 44px; max-width: 460px; margin: 0 auto;
          position: relative; isolation: isolate;
        }
        /* Le champ ASCII occupe la place que la donnee occupera. Il deborde
           volontairement du bloc de texte : c'est la salle, pas une vignette. */
        .p4t-comingsoon-field {
          position: absolute; z-index: -1; pointer-events: none;
          left: 50%; transform: translateX(-50%);
          top: -18px; width: min(96vw, 900px); height: calc(100% + 36px);
          -webkit-mask-image: radial-gradient(ellipse at center, #000 38%, transparent 78%);
          mask-image: radial-gradient(ellipse at center, #000 38%, transparent 78%);
        }
        .p4t-comingsoon > *:not(.p4t-comingsoon-field) { position: relative; }

        /* --- heros scrube ------------------------------------------------ */
        /* --- fond video ---------------------------------------------------
           La video est le fond du site : fixe, plein ecran, derriere tout.
           Le voile au-dessus n'est pas constant, il est pilote au scroll par
           BackdropFilm : leger en haut ou l'image doit porter, epais plus bas
           ou c'est le chiffre qui doit porter. */
        /* z-index NEGATIF, et non 0 : le fond est un enfant de .p4t-app, or un
           element positionne a z-index 0 peint AU-DESSUS du contenu en flux
           normal et masque tout le texte, en ne laissant voir que les elements
           eux-memes positionnes. A -1 il passe derriere le contenu, tout en
           restant au-dessus du fond transparent de .p4t-app. */
        .p4t-backdrop { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: var(--bg); }
        .p4t-backdrop-vid, .p4t-backdrop-poster {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .p4t-backdrop-poster { z-index: 1; transition: opacity .5s ease; }
        .p4t-backdrop-vid { z-index: 0; }
        .p4t-backdrop-scrim {
          position: absolute; inset: 0; z-index: 2;
          background: var(--bg); opacity: .28;
        }

        /* La lisibilite ne vient plus de l'effacement de l'image mais d'un flou
           derriere les surfaces : le fond reste visible et le texte reste net. */
        .p4t-card, .p4t-match-card, .p4t-fixture-row, .p4t-tile, .p4t-standings,
        .p4t-comp-tab, .p4t-tab, .p4t-search-wrap, .p4t-podium-card,
        .p4t-record-card, .p4t-highlight-card, .p4t-featured, .p4t-club-card {
          backdrop-filter: blur(14px) saturate(1.15);
          -webkit-backdrop-filter: blur(14px) saturate(1.15);
        }

        /* Le premier ecran laisse la place a l'image ; le texte y prend une
           ombre portee, sinon il se pose sur une video en mouvement. */
        .p4t-hero-first {
          min-height: 74vh;
          display: flex; flex-direction: column; justify-content: center;
        }
        /* Le premier ecran est une photo. Le texte y est clair dans LES DEUX
           themes, avec son propre voile sous lui : de l'encre sombre sur une
           image sombre disparait, et suivre le theme ici serait une erreur. */
        .p4t-hero-first { position: relative; isolation: isolate; }
        .p4t-hero-first::before {
          content: ''; position: absolute; z-index: -1; pointer-events: none;
          top: -30px; bottom: -30px;
          left: calc(50% - 50vw); right: calc(50% - 50vw);
          background: linear-gradient(to bottom,
            rgba(10,7,5,.10) 0%, rgba(10,7,5,.58) 42%,
            rgba(10,7,5,.58) 68%, rgba(10,7,5,0) 100%);
        }
        .p4t-hero-first .p4t-hero-title { color: #F6F0E4; text-shadow: 0 2px 22px rgba(0,0,0,.6); }
        .p4t-hero-first .p4t-hero-sub { color: rgba(246,240,228,.9); text-shadow: 0 1px 14px rgba(0,0,0,.6); }
        .p4t-hero-first .p4t-eyebrow { color: #FFB020; text-shadow: 0 1px 12px rgba(0,0,0,.7); }

        @media (prefers-reduced-motion: reduce) {
          .p4t-backdrop-vid { display: none; }
        }

        .p4t-comingsoon-title { font-family: var(--font-display); font-size: 22px; font-weight: 600; margin: 16px 0 4px; }
        .p4t-comingsoon-loc { color: var(--ink-dim); font-size: 13px; margin: 0 0 16px; }
        .p4t-comingsoon-text { color: var(--ink-dim); font-size: 13.5px; line-height: 1.6; }

        .p4t-match-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
        .p4t-match-card {
          text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
          padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; transition: transform .15s, border-color .15s;
        }
        .p4t-match-card:hover { transform: translateY(-2px); border-color: var(--red); }
        .p4t-match-card-top { display: flex; justify-content: space-between; align-items: center; }
        .p4t-match-card-date { font-size: 11.5px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; }
        .p4t-match-card-opponent { font-size: 13px; color: var(--ink-dim); }
        .p4t-vs { color: var(--ink-dim); opacity: 0.6; font-size: 11px; margin: 0 2px; }
        .p4t-match-card-score { font-family: var(--font-mono); font-size: 24px; font-weight: 600; color: var(--ink); }
        .p4t-score-sep { color: var(--ink-dim); margin: 0 6px; font-weight: 400; }
        .p4t-match-card-stats { display: flex; gap: 14px; font-size: 12px; border-top: 1px solid var(--line); padding-top: 8px; align-items: center; flex-wrap: wrap; }
        .p4t-chip-primary { display: flex; align-items: center; gap: 4px; color: var(--red); font-weight: 600; }

        .p4t-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 700; width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
        .p4t-badge-win { background: rgba(47,168,160,0.15); color: var(--green); }
        .p4t-badge-loss { background: rgba(255,176,32,0.15); color: var(--heat); }

        .p4t-back-btn {
          display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--ink-dim);
          font-size: 13px; padding: 0 0 18px; font-weight: 500;
        }
        .p4t-back-btn:hover { color: var(--ink); }

        .p4t-view-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .p4t-share-btn {
          display: flex; align-items: center; gap: 6px; background: none; border: 1px solid var(--line);
          color: var(--red); font-size: 12.5px; font-weight: 600; padding: 7px 12px; border-radius: 8px;
        }
        .p4t-share-btn:hover { border-color: var(--red); background: var(--panel); }
        .p4t-compare-btn { margin: 16px 0 20px; }

        .p4t-modal-overlay {
          position: fixed; inset: 0; background: rgba(10,10,10,0.72); display: flex; align-items: center;
          justify-content: center; z-index: 100; padding: 24px;
        }
        .p4t-modal { position: relative; width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .p4t-modal-close {
          position: absolute; top: -44px; right: 0; background: rgba(255,255,255,0.12); border: none; color: #fff;
          width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }

        .p4t-sharecard {
          width: 100%; aspect-ratio: 4 / 5; background: #111111; border-radius: 16px; overflow: hidden;
          position: relative; padding: 22px 20px; display: flex; flex-direction: column;
          background-image: radial-gradient(circle at 85% 6%, rgba(255,176,32,0.35), transparent 45%);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5); font-family: var(--font-body);
        }
        /* La carte DOM est l'apercu exact du PNG : elle a le meme fond sombre
           fixe, donc elle doit avoir la meme palette fixe. Ces jetons locaux
           neutralisent le theme a l'interieur de la carte, et seulement la. */
        .p4t-sharecard {
          --ink: #F6F0E4;
          --ink-dim: #A2937E;
          --amber: #FFB020;
        }
        .p4t-sharecard-topbar { position: absolute; top: 0; left: 0; right: 0; height: 4px; background: var(--amber); }
        .p4t-sharecard-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
        .p4t-sharecard-brand { font-family: var(--font-display); font-weight: 600; font-size: 12px; letter-spacing: 0.06em; color: var(--ink); }
        .p4t-sharecard-season { font-size: 10.5px; color: var(--ink-dim); }
        .p4t-sharecard-team { font-family: var(--font-display); font-weight: 600; font-size: 12px; letter-spacing: 0.05em; color: var(--amber); }
        .p4t-sharecard-loc { font-size: 10.5px; color: var(--ink-dim); margin-bottom: 16px; }
        .p4t-sharecard-name { font-family: var(--font-display); font-weight: 700; font-size: 27px; color: var(--ink); line-height: 1.08; margin-bottom: 8px; }
        .p4t-sharecard-meta { font-size: 12px; color: var(--ink-dim); margin-bottom: auto; }
        .p4t-sharecard-number { color: var(--amber); font-weight: 700; font-family: var(--font-display); margin-right: 6px; }
        .p4t-sharecard-stats { display: flex; justify-content: space-between; margin: 20px 0 14px; }
        .p4t-sharecard-stat { text-align: center; flex: 1; }
        .p4t-sharecard-stat-value { font-family: var(--font-mono); font-weight: 700; font-size: 24px; color: var(--ink); }
        .p4t-sharecard-stat-label { font-size: 9px; color: var(--ink-dim); letter-spacing: 0.04em; margin-top: 2px; }
        .p4t-sharecard-footer {
          display: flex; justify-content: space-between; align-items: center; padding-top: 12px;
          border-top: 1px solid rgba(255,255,255,0.12); font-size: 10px; color: var(--ink-dim);
        }
        .p4t-sharecard-footer-center { justify-content: center; }
        .p4t-sharecard-url { color: var(--amber); font-weight: 600; }

        .p4t-sharecard-match { background-image: radial-gradient(circle at 15% 8%, rgba(47,168,160,0.28), transparent 45%); }
        .p4t-sharecard-matchup { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; margin: 26px 0 16px; }
        .p4t-sharecard-matchup-team { font-weight: 600; font-size: 12px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.03em; }
        .p4t-sharecard-matchup-score { font-family: var(--font-mono); font-weight: 700; font-size: 52px; color: var(--ink); line-height: 1.05; }
        .p4t-sharecard-matchup-sep { color: var(--ink-dim); font-size: 16px; margin: 0; }
        .p4t-sharecard-topscorer { text-align: center; color: var(--amber); font-weight: 600; font-size: 14px; margin-bottom: auto; }

        .p4t-sharecard-highlight-dunk  { background-image: radial-gradient(circle at 82% 12%, rgba(255,176,32,0.4), transparent 45%); }
        .p4t-sharecard-highlight-3pts  { background-image: radial-gradient(circle at 82% 12%, rgba(47,168,160,0.35), transparent 45%); }
        .p4t-sharecard-highlight-block { background-image: radial-gradient(circle at 82% 12%, rgba(246,240,228,0.2), transparent 45%); }
        .p4t-sharecard-highlight-assist { background-image: radial-gradient(circle at 82% 12%, rgba(47,168,160,0.35), transparent 45%); }
        .p4t-sharecard-highlight-move { background-image: radial-gradient(circle at 82% 12%, rgba(255,176,32,0.4), transparent 45%); }
        .p4t-sharecard-highlight-buzzer { background-image: radial-gradient(circle at 82% 12%, rgba(246,240,228,0.2), transparent 45%); }
        .p4t-sharecard-hl-type { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 700; font-size: 32px; text-transform: uppercase; margin-top: 34px; }
        .p4t-sharecard-highlight-dunk .p4t-sharecard-hl-type  { color: var(--amber); }
        .p4t-sharecard-highlight-3pts .p4t-sharecard-hl-type  { color: var(--teal); }
        .p4t-sharecard-highlight-block .p4t-sharecard-hl-type { color: var(--ink); }
        .p4t-sharecard-highlight-assist .p4t-sharecard-hl-type { color: var(--teal); }
        .p4t-sharecard-highlight-move .p4t-sharecard-hl-type { color: var(--amber); }
        .p4t-sharecard-highlight-buzzer .p4t-sharecard-hl-type { color: var(--ink); }
        .p4t-sharecard-hl-duration { font-family: var(--font-mono); color: var(--ink-dim); font-size: 12px; margin-top: 4px; }
        .p4t-sharecard-hl-name { margin-top: 26px; margin-bottom: 6px; }

        .p4t-sharecard-download {
          display: flex; align-items: center; gap: 8px; background: var(--red); color: #fff; border: none;
          padding: 12px 22px; border-radius: 10px; font-weight: 600; font-size: 14px; width: 100%; justify-content: center;
        }

        .p4t-scorebug { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-bottom: 8px; }
        .p4t-scorebug-meta { font-size: 11.5px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .p4t-scorebug-row { display: flex; align-items: center; justify-content: center; gap: 22px; }
        .p4t-scorebug-team { font-family: var(--font-display); font-size: 16px; font-weight: 500; flex: 1; text-align: right; }
        .p4t-scorebug-team-away { text-align: left; }
        .p4t-scorebug-score { font-family: var(--font-mono); font-size: 32px; font-weight: 700; color: var(--red); white-space: nowrap; }

        .p4t-tile-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
        .p4t-tile-row-compact { grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); }
        .p4t-tile {
          position: relative; background: var(--panel-raised); border: 1px solid var(--line); border-radius: 10px;
          padding: 14px 14px 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3);
        }
        .p4t-tile-secondary {
          background: transparent; border: 1px dashed var(--line); box-shadow: none; padding: 10px 12px 9px;
        }
        .p4t-rivet { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: var(--line); }
        .p4t-rivet-tl { top: 6px; left: 6px; } .p4t-rivet-tr { top: 6px; right: 6px; }
        .p4t-rivet-bl { bottom: 6px; left: 6px; } .p4t-rivet-br { bottom: 6px; right: 6px; }
        .p4t-tile-icon { color: var(--red); margin-bottom: 8px; }
        .p4t-tile-secondary .p4t-tile-icon { color: var(--ink-dim); margin-bottom: 5px; }
        .p4t-tile-value { font-family: var(--font-mono); font-size: 24px; font-weight: 600; color: var(--ink); line-height: 1; }
        .p4t-tile-secondary .p4t-tile-value { font-size: 16px; color: var(--ink-dim); }
        .p4t-tile-unit { font-size: 12px; color: var(--ink-dim); margin-left: 3px; }
        .p4t-tile-label { font-size: 11px; color: var(--ink-dim); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.03em; }
        .p4t-tile-secondary .p4t-tile-label { font-size: 9.5px; margin-top: 4px; }
        .p4t-tile-sub { font-size: 9.5px; color: var(--ink-dim); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .p4t-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
        .p4t-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
        .p4t-table th { text-align: right; padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--line); white-space: nowrap; }
        .p4t-table .p4t-th-name { text-align: left; }
        .p4t-table td { text-align: right; padding: 10px 14px; border-bottom: 1px solid var(--line); font-family: var(--font-mono); font-size: 12.5px; }
        .p4t-table tr:last-child td { border-bottom: none; }
        .p4t-table-total-row td {
          background: var(--panel); font-weight: 700; border-top: 2px solid var(--line); border-bottom: none;
        }
        .p4t-table-total-row .p4t-td-name { font-family: var(--font-body) !important; }
        .p4t-quarters-table { min-width: 460px; }
        .p4t-quarters-total { color: var(--red); font-weight: 700; }
        .p4t-td-name { text-align: left !important; font-family: var(--font-body) !important; display: flex; align-items: center; gap: 9px; }
        .p4t-tr-click { cursor: pointer; }
        .p4t-tr-click:hover td { background: var(--panel); }
        .p4t-sort-btn { background: none; border: none; color: var(--ink-dim); font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px; }
        .p4t-sort-btn:hover { color: var(--ink); }
        .p4t-number { color: var(--ink-dim); font-size: 11px; margin-left: 7px; font-family: var(--font-mono); }
        .p4t-inline-link { cursor: pointer; text-decoration-color: transparent; transition: color .15s; }
        .p4t-inline-link:hover { color: var(--red); text-decoration: underline; }
        .p4t-standing-rank { color: var(--ink-dim); font-size: 11px; font-family: var(--font-mono); width: 14px; flex-shrink: 0; }

        .p4t-secondary-panel { border: 1px dashed var(--line); border-radius: 12px; padding: 14px 16px; }

        .p4t-players-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
        .p4t-player-card {
          display: flex; align-items: center; gap: 12px; text-align: left; background: var(--panel);
          border: 1px solid var(--line); border-radius: 11px; padding: 12px 14px; transition: border-color .15s;
        }
        .p4t-player-card:hover { border-color: var(--red); }
        .p4t-player-card-info { flex: 1; min-width: 0; }
        .p4t-player-card-name {
          font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis;
        }
        .p4t-player-card-pos { font-size: 11.5px; color: var(--ink-dim); margin-top: 1px; }
        .p4t-player-card-stats { text-align: right; flex-shrink: 0; }
        .p4t-player-card-stat { font-size: 12px; color: var(--red); font-weight: 600; display: flex; align-items: center; gap: 4px; justify-content: flex-end; white-space: nowrap; }

        .p4t-avatar {
          width: 36px; height: 36px; border-radius: 50%; background: var(--panel-raised); border: 1px solid var(--line);
          color: var(--red); font-family: var(--font-display); font-size: 12.5px; font-weight: 600;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        /* Ces logos sont dessines pour du blanc. On les pose donc sur une
           pastille claire dans les DEUX themes plutot que de detourer le blanc,
           ce qui detruirait les elements blancs de certains d entre eux. */
        .p4t-avatar-logo {
          background: #FBF8F2; border-color: rgba(0,0,0,.10);
          overflow: hidden; padding: 3px;
        }
        .p4t-avatar-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }

        .p4t-avatar-sm { width: 26px; height: 26px; font-size: 10.5px; }
        .p4t-avatar-lg { width: 62px; height: 62px; font-size: 20px; }
        .p4t-avatar-muted { color: var(--ink-dim); border-style: dashed; }

        .p4t-profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
        .p4t-profile-name { font-family: var(--font-display); font-size: 26px; font-weight: 600; margin: 0; }
        .p4t-profile-pos { color: var(--ink-dim); font-size: 13px; margin: 2px 0 0; }
        .p4t-profile-rank {
          display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 600;
          color: var(--red); background: rgba(255,176,32,0.08); padding: 5px 10px; border-radius: 7px;
        }

        .p4t-chart-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }

        @media (max-width: 720px) {
          .p4t-nav { padding: 12px 16px; }
          .p4t-search-nav { display: none; }
          .p4t-main { padding: 20px 16px 40px; }
          .p4t-hero-title { font-size: 26px; }
          .p4t-scorebug-row { gap: 10px; }
          .p4t-scorebug-team { font-size: 12.5px; }
          .p4t-scorebug-score { font-size: 24px; }
        }
      `}</style>

      <nav className="p4t-nav">
        <div className="p4t-nav-brand p4t-nav-brand-click" onClick={goHome}>
          <span className="p4t-nav-brand-dot" />MatinikStats
          {screen === 'team' && selectedTeam && (
            <><span className="p4t-nav-team-sep">/</span><span className="p4t-nav-team-name">{selectedTeam.name}</span></>
          )}
        </div>
        <div className="p4t-nav-tabs">
          <button className="p4t-tab" onClick={showAllStandings}>Classement</button>
          <button className="p4t-tab" onClick={showAllCalendar}>Calendrier</button>
          <button className="p4t-tab" onClick={showAllLeaders}>Leaders</button>
          <button className="p4t-tab" onClick={showAllHighlights}>Highlights</button>
          <button className="p4t-tab" onClick={showAllPlayers}>Joueurs</button>
          <button className="p4t-tab" onClick={showAllClubs}>Clubs</button>
        </div>
        <SearchBox variant="nav" placeholder="Chercher…" items={globalSearchableItems} onSelect={handleGlobalSearchSelect} />
        <ThemeToggle />
      </nav>

      <DemoBanner />

      <BackdropFilm />

      {screen === 'home' && (
        <PlatformHome
          onSelectTeam={selectTeam}
          onOpenMatch={openMatchFromHome}
          onOpenPlayer={openPlayerFromHome}
          onShowAllMatches={showAllMatches}
          onShowAllPlayers={showAllPlayers}
          onShowAllClubs={showAllClubs}
          onShowAllStandings={showAllStandings}
          onShowAllCalendar={showAllCalendar}
          onShowAllRecords={showAllRecords}
          onShowWeekDetail={showWeekDetail}
          onShowAllLeaders={showAllLeaders}
          onShowAllHighlights={showAllHighlights}
        />
      )}
      {screen === 'allMatches' && (
        <AllMatchesView onOpenMatch={openMatchFromHome} onBack={goHome} onSelectTeam={selectTeam} onOpenPlayer={openPlayerFromHome} />
      )}
      {screen === 'allCalendar' && (
        <AllCalendarView onOpenMatch={openMatchFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allRecords' && (
        <AllRecordsView onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'matchDetail' && (
        <MatchDetailView matchId={neutralMatchId} onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'weekDetail' && (
        <PlayerOfWeekView matchId={weekMatchId} onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'compare' && compareA && (
        <PlayerComparisonView teamIdA={compareA.teamId} playerIdA={compareA.playerId} onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allPlayers' && (
        <AllPlayersView onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allClubs' && (
        <AllClubsView onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allStandings' && (
        <AllStandingsView onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allLeaders' && (
        <AllLeadersView onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'allHighlights' && (
        <AllHighlightsView onOpenPlayer={openPlayerFromHome} onSelectTeam={selectTeam} onBack={goHome} />
      )}
      {screen === 'team' && selectedTeam && teamHasData(selectedTeam.id) && (
        <TeamApp
          team={selectedTeam}
          initialView={teamEntry.view}
          initialMatchId={teamEntry.matchId}
          initialPlayerId={teamEntry.playerId}
          onSelectTeam={selectTeam}
          onCompare={showCompare}
          onGoHome={goHome}
          onOpenAnyPlayer={openPlayerFromHome}
        />
      )}
      {screen === 'team' && selectedTeam && !teamHasData(selectedTeam.id) && (
        <TeamComingSoon team={selectedTeam} onBack={goHome} />
      )}
    </div>
  );
}
