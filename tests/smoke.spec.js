// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/*
 * VÉRIFICATEUR. Chaque contrôle ici correspond à une régression RÉELLE survenue
 * pendant la refonte, et qui passait `npm run build` sans broncher. C'est le
 * point : `vite build` réussit sur une page dont tout le texte a disparu.
 *
 * Un contrôle qui n'a jamais attrapé de bug n'est pas un contrôle, c'est une
 * décoration. La preuve que chacun mord est dans tests/PREUVE.md : on réinjecte
 * le bug et on montre le rouge.
 *
 * Ces fichiers sont le VÉRIFICATEUR. Une pull request qui les modifie ne peut
 * pas être fusionnée automatiquement : le job `guard` du workflow échoue.
 */

const THEMES = ['dark', 'light'];

// faux=on par defaut DANS LES TESTS: la plupart des controles ont besoin de
// donnees pour s exercer, et le site n en fabrique plus par defaut depuis que
// l interrupteur est inverse. Le controle de l etat par defaut, lui, passe
// explicitement faux=null.
async function boot(page, theme, faux = 'on') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(faux ? `/?faux=${faux}` : '/', { waitUntil: 'load' });
  await page.evaluate((t) => localStorage.setItem('matinik-theme', t), theme);
  await page.goto(faux ? `/?faux=${faux}` : '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return errors;
}

function luminance(rgb) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const [r, g, b] = m.slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const theme of THEMES) {
  test.describe(`thème ${theme}`, () => {
    test('aucune erreur de page', async ({ page }) => {
      const errors = await boot(page, theme);
      expect(errors, `erreurs de page: ${errors.join(' | ')}`).toEqual([]);
    });

    // Régression vécue : le fond vidéo était un enfant positionné à z-index 0,
    // donc il peignait AU-DESSUS du contenu en flux normal. Tout le texte avait
    // disparu, seules les vignettes restaient, et le build était vert.
    test('les titres de section sont présents et ont une hauteur non nulle', async ({ page }) => {
      await boot(page, theme);
      await page.evaluate(() => (document.documentElement.scrollTop = 1200));
      await page.waitForTimeout(700);
      // Presence et hauteur ne suffisent PAS : un titre recouvert par un calque
      // opaque garde sa hauteur. La premiere version de ce controle passait sur
      // le bug qu'il devait attraper. On teste donc le recouvrement reel : au
      // centre du titre, l'element au premier plan doit etre le titre lui-meme
      // ou l'un de ses descendants.
      const titres = await page.evaluate(() =>
        [...document.querySelectorAll('.p4t-section-title')]
          .map((e) => {
            const r = e.getBoundingClientRect();
            if (r.height === 0 || r.top < 0 || r.bottom > innerHeight) return null;
            const dessus = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
            return {
              t: e.textContent.trim(),
              h: Math.round(r.height),
              couvert: !(dessus === e || e.contains(dessus)),
              par: dessus ? (dessus.className || dessus.tagName).toString().slice(0, 40) : 'rien',
            };
          })
          .filter(Boolean),
      );
      expect(titres.length, 'aucun titre de section visible a l ecran').toBeGreaterThan(0);
      for (const x of titres) {
        expect(x.h, `titre "${x.t}" de hauteur nulle`).toBeGreaterThan(0);
        expect(x.couvert, `titre "${x.t}" recouvert par ${x.par}`).toBe(false);
      }
    });

    // Régression vécue : en thème clair, le titre du héros était de l'encre
    // sombre posée sur une photo sombre. Présent dans le DOM, illisible à l'oeil.
    test('le titre du héros contraste avec son fond', async ({ page }) => {
      await boot(page, theme);
      const r = await page.evaluate(() => {
        const t = document.querySelector('.p4t-hero-first .p4t-hero-title');
        if (!t) return null;
        return { couleur: getComputedStyle(t).color, hauteur: t.getBoundingClientRect().height };
      });
      expect(r, 'titre du héros absent').not.toBeNull();
      expect(r.hauteur).toBeGreaterThan(10);
      // Le héros est posé sur une photo assombrie : son texte doit être clair
      // dans LES DEUX thèmes. Suivre le thème ici est précisément le bug.
      expect(luminance(r.couleur), `titre trop sombre sur la photo: ${r.couleur}`).toBeGreaterThan(150);
    });

    // Régression vécue : la carte de partage garde un fond #111111 en dur, mais
    // son texte était passé aux jetons du thème. En thème clair : #1A140D sur
    // #111111. Et cette carte part circuler seule, sans le site autour.
    test('la carte de partage contraste avec son propre fond', async ({ page }) => {
      await boot(page, theme);
      await page.evaluate(() => (document.documentElement.scrollTop = 1500));
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const s = document.querySelector('[aria-label="Partager ce highlight"]');
        if (s) s.click();
      });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const c = document.querySelector('.p4t-sharecard');
        if (!c) return null;
        const nom = c.querySelector('.p4t-sharecard-name');
        return { fond: getComputedStyle(c).backgroundColor, texte: getComputedStyle(nom).color };
      });
      expect(r, 'carte de partage non ouverte').not.toBeNull();
      const ecart = Math.abs(luminance(r.texte) - luminance(r.fond));
      expect(ecart, `texte ${r.texte} sur fond ${r.fond}`).toBeGreaterThan(90);
    });

    test('pas de débordement horizontal en 1440 et en 393', async ({ page }) => {
      await boot(page, theme);
      for (const w of [1440, 393]) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(600);
        const ov = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(ov, `débordement de ${ov}px en largeur ${w}`).toBeLessThanOrEqual(0);
      }
    });
  });
}

// Le clip de fond est piloté par le scroll. S'il ne bouge pas, le fond est une
// image fixe et la moitié de la refonte ne sert à rien.
test('le clip de fond avance avec le scroll', async ({ page }) => {
  await boot(page, 'dark');
  await page.waitForTimeout(2500);
  const R = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const t = [];
  for (const f of [0, 0.5, 1]) {
    await page.evaluate((y) => (document.documentElement.scrollTop = y), Math.round(f * R));
    await page.waitForTimeout(900);
    t.push(await page.evaluate(() => {
      const v = document.querySelector('.p4t-backdrop-vid');
      return v ? Number(v.currentTime.toFixed(1)) : -1;
    }));
  }
  expect(t[0], `temps au sommet: ${t}`).toBeLessThan(0.5);
  expect(t[1], `temps à mi-page: ${t}`).toBeGreaterThan(t[0]);
  expect(t[2], `temps en bas: ${t}`).toBeGreaterThan(t[1]);
});

// Contrôle statique. Un contexte canvas 2D ne résout pas var() : l'affectation
// est ignorée en silence et la couleur précédente reste active. Le PNG sort
// avec de mauvaises couleurs et rien n'échoue. Trouvé par Codex et par Fable.
test('aucune variable CSS passée à un contexte canvas', async () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'App.jsx'), 'utf8');
  const fautes = [...src.matchAll(/(fillStyle|strokeStyle|shadowColor)\s*=\s*['"`]var\(--/g)];
  expect(
    fautes.length,
    `${fautes.length} affectation(s) de var() sur un contexte canvas`,
  ).toBe(0);
});

// Le bandeau de demonstration est la reponse a l issue #1 : le site attribue a
// des clubs REELS des resultats fabriques. S il disparait, le site redevient
// trompeur sans qu aucune erreur ne soit levee. Ce controle existe pour que sa
// suppression ne soit jamais silencieuse.
for (const theme of THEMES) {
  test(`thème ${theme} · le bandeau de démonstration est visible`, async ({ page }) => {
    await boot(page, theme);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.p4t-demo-banner');
      if (!b) return null;
      const q = b.getBoundingClientRect();
      const st = getComputedStyle(b);
      return {
        hauteur: Math.round(q.height),
        haut: Math.round(q.top),
        texte: b.textContent.replace(/\s+/g, ' ').trim(),
        couleur: st.color,
        fond: st.backgroundColor,
      };
    });
    expect(r, 'bandeau de démonstration absent').not.toBeNull();
    expect(r.hauteur, 'bandeau de hauteur nulle').toBeGreaterThan(10);
    expect(r.haut, 'bandeau hors écran').toBeLessThan(200);
    expect(r.texte).toContain('fabriqués');
    // Il doit aussi etre LISIBLE : un bandeau present mais invisible ne dit rien.
    const ecart = Math.abs(luminance(r.couleur) - luminance(r.fond));
    expect(ecart, `bandeau ${r.couleur} sur ${r.fond}`).toBeGreaterThan(60);
  });
}

// Une carte de partage part circuler seule, sans le bandeau. Elle doit porter
// la mention elle-meme, dans le PNG, pas seulement dans l apercu.
test('le PNG de partage porte le tampon de démonstration', async ({ page }, testInfo) => {
  await boot(page, 'dark');
  await page.evaluate(() => (document.documentElement.scrollTop = 1500));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const s = document.querySelector('[aria-label="Partager ce highlight"]');
    if (s) s.click();
  });
  await page.waitForTimeout(900);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Télécharger/.test(x.textContent));
      if (b) b.click();
    }),
  ]);
  const chemin = testInfo.outputPath('carte.png');
  await dl.saveAs(chemin);
  const taille = fs.statSync(chemin).size;
  expect(taille, 'PNG vide').toBeGreaterThan(10000);

  // On relit le PNG dans une page et on compte les pixels de la couleur d alerte
  // dans la bande basse, la ou le tampon est dessine.
  const rouges = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const y0 = img.height - 60;
    const d = x.getImageData(Math.round(img.width * 0.2), y0, Math.round(img.width * 0.6), 50).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 95) n++;
    }
    return n;
  }, 'data:image/png;base64,' + fs.readFileSync(chemin).toString('base64'));
  expect(rouges, 'aucun tampon de démonstration dans le PNG').toBeGreaterThan(200);
});

// Les logos sont ceux de clubs REELS et la couverture est PARTIELLE: 15 sur 30.
// Deux choses doivent donc tenir, et la seconde autant que la premiere: les
// logos presents s'affichent, et les clubs sans logo gardent leurs initiales.
// Un repli casse laisserait la moitie du championnat avec des pastilles vides.
test('les logos de clubs s affichent et le repli sur initiales tient', async ({ page }) => {
  const err404 = [];
  page.on('response', (r) => {
    // >= 400 seulement: un 304 Not Modified est un succes servi par le cache,
    // pas un echec. La premiere version de ce controle le comptait comme une
    // erreur et echouait donc sur du code sain.
    if (r.url().includes('/logos/') && r.status() >= 400) err404.push(`${r.status()} ${r.url()}`);
  });
  await boot(page, 'dark');
  // On va sur la vue Clubs plutot que de faire confiance a une position de
  // scroll: la hauteur de page depend du contenu, et la premiere version de ce
  // controle echouait sur du code sain pour cette seule raison.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.p4t-tab')].find((x) => x.textContent.trim() === 'Clubs');
    if (b) b.click();
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    logos: document.querySelectorAll('.p4t-avatar-logo').length,
    initiales: [...document.querySelectorAll('.p4t-avatar')].filter(
      (e) => !e.classList.contains('p4t-avatar-logo') && e.textContent.trim().length > 0,
    ).length,
    cassees: [...document.querySelectorAll('.p4t-avatar-logo img')].filter(
      (i) => i.complete && i.naturalWidth === 0,
    ).length,
  }));
  expect(r.logos, 'aucun logo de club affiché').toBeGreaterThan(3);
  expect(r.initiales, 'aucun repli sur initiales: les clubs sans logo sont vides').toBeGreaterThan(3);
  expect(r.cassees, 'des images de logo sont cassées').toBe(0);
  expect(err404, `requêtes de logo en échec: ${err404.join(', ')}`).toEqual([]);
});


// L INTERRUPTEUR. Par defaut le site ne fabrique RIEN: c est le seul sens qui
// protege les clubs reels, puisqu un defaut qui invente oblige a penser a
// l eteindre alors qu un defaut qui dit la verite ne se trompe pas par oubli.
test('par défaut, aucune donnée fabriquée n est affichée', async ({ page }) => {
  const errors = await boot(page, 'dark', null);
  expect(errors, `erreurs de page: ${errors.join(' | ')}`).toEqual([]);
  const r = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      clubs: document.querySelectorAll('.p4t-team-card').length,
      highlights: document.querySelectorAll('.p4t-highlight-card').length,
      scores: (t.match(/\b\d{2}\s*[–-]\s*\d{2}\b/g) || []).length,
      bandeau: (document.querySelector('.p4t-demo-banner') || {}).textContent || '',
    };
  });
  // Les 30 clubs sont REELS: ils doivent rester. C est le reste qui disparait.
  expect(r.clubs, 'les clubs réels ont disparu').toBe(30);
  expect(r.highlights, 'des temps forts fabriqués sont affichés par défaut').toBe(0);
  expect(r.scores, 'des scores fabriqués sont affichés par défaut').toBe(0);
  // Et le bandeau doit dire la verite du moment, pas l inverse.
  expect(r.bandeau).toContain('EN ATTENTE DE CAPTATION');
  expect(r.bandeau).not.toContain('fabriqués');
});

// Toutes les combinaisons de l interrupteur doivent tenir. Eteindre une famille
// a revele SEPT plantages caches, tous du meme genre: du code qui supposait que
// la donnee est toujours la.
test('toutes les combinaisons de l interrupteur se chargent sans erreur', async ({ page }) => {
  const combis = ['on', 'off', 'rosters', 'fixtures', 'highlights', 'score', 'mouvement',
                  'fixtures,score', 'rosters,highlights', 'nimportequoi'];
  const casses = [];
  for (const c of combis) {
    const errs = [];
    const h = (e) => errs.push(String(e));
    page.on('pageerror', h);
    await page.goto(`/?faux=${c}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    page.off('pageerror', h);
    if (errs.length) casses.push(`${c}: ${errs[0].slice(0, 90)}`);
  }
  expect(casses, `combinaisons en échec:\n${casses.join('\n')}`).toEqual([]);
});

/* --- LE RECEPTACLE DES DONNEES REELLES -----------------------------------
   Controles sans navigateur, directement sur le chargeur. La regle qu ils
   protegent: aucun enregistrement n entre sans provenance. C est la seule
   chose qui distingue une vraie donnee d une donnee fabriquee une fois le
   chiffre affiche. */

const { chargerReel } = await import('../src/donnees/charger.js');
const CLUBS = ['etoile', 'carbet'];
const OK = { source: 'LMBB', releve: '2026-08-29', mode: 'manuel' };
const match = (p) => ({ id: 'm1', date: '2026-02-01', domicile: 'etoile', visiteur: 'carbet', provenance: p });

test('le chargeur accepte un enregistrement correctement sourcé', () => {
  const r = chargerReel({ calendrier: [match(OK)] }, CLUBS);
  expect(r.compte.calendrier).toBe(1);
  expect(r.compte.joues, 'un match sans score ne doit pas compter comme joué').toBe(0);
  expect(r.calendrier[0].homeScore, 'un match non joué a un score null, pas zéro').toBeNull();
});

test('le chargeur REFUSE un enregistrement sans provenance', () => {
  expect(() => chargerReel({ calendrier: [match(undefined)] }, CLUBS)).toThrow(/provenance absente/);
  expect(() => chargerReel({ calendrier: [match({ releve: '2026-08-29', mode: 'manuel' })] }, CLUBS)).toThrow(/sans source/);
  expect(() => chargerReel({ calendrier: [match({ source: 'X', mode: 'manuel' })] }, CLUBS)).toThrow(/date de relevé/);
  expect(() => chargerReel({ calendrier: [match({ source: 'X', releve: '2026-08-29', mode: 'devine' })] }, CLUBS)).toThrow(/mode "devine" inconnu/);
});

test('le chargeur signale un club inconnu au lieu de l ignorer', () => {
  const r = chargerReel({ calendrier: [{ ...match(OK), visiteur: 'club-fantome' }] }, CLUBS);
  expect(r.clubsInconnus, 'un club inconnu doit être signalé, pas jeté en silence').toContain('club-fantome');
});

test('le fichier de données réelles du dépôt se charge sans erreur', async () => {
  const brut = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'src', 'donnees', 'reel.json'), 'utf8'));
  const r = chargerReel(brut, CLUBS);
  expect(r.clubsInconnus, `clubs inconnus dans reel.json: ${r.clubsInconnus.join(', ')}`).toEqual([]);
});

/* --- LA TABLE DE CORRESPONDANCE ------------------------------------------
   Aucune source publique ne donne d identifiant de club commun, et le
   rapprochement par nom casse sur des cas reels: REBOND PILOTAIN contre
   Le Rebond Pilotin, Baloncesto de Floreal contre USAC de Floréal. La table
   est donc ecrite a la main. Ces controles protegent le fait qu AUCUN
   rapprochement automatique ne se glisse dans le chargeur. */

const corr = (idSource, teamId) => ({ source: 'CTOS', idSource, teamId, provenance: OK });

test('un identifiant de source se résout par la table, jamais par le nom', () => {
  // La provenance déclare l'espace de noms: le calendrier vient de la LMBB mais
  // nomme les clubs avec les libellés du CTOS. C'est le cas réel attendu.
  const provCTOS = { ...OK, espaceNoms: 'CTOS' };
  const brut = {
    correspondances: [corr('REBOND PILOTAIN', 'carbet')],
    calendrier: [{ id: 'm1', date: '2026-02-01', domicile: 'REBOND PILOTAIN', visiteur: 'etoile', provenance: provCTOS }],
  };
  const r = chargerReel(brut, CLUBS);
  expect(r.calendrier[0].homeTeamId, 'la table doit résoudre').toBe('carbet');
});

test('un identifiant absent de la table n est PAS deviné', () => {
  // Volontairement proche d un teamId connu: un rapprocheur naïf le mapperait.
  const brut = {
    calendrier: [{ id: 'm1', date: '2026-02-01', domicile: 'Etoile Sportive', visiteur: 'etoile', provenance: OK }],
  };
  const r = chargerReel(brut, CLUBS);
  expect(r.clubsInconnus, 'un nom proche doit être signalé, pas deviné').toContain('Etoile Sportive');
  expect(r.calendrier.length, 'un match non résolu ne doit pas être affiché').toBe(0);
});

test('une correspondance peut viser null: la source connaît un club que nous n avons pas', () => {
  const brut = {
    correspondances: [corr('THUNDER ROCK DIAMANT', null)],
    calendrier: [{ id: 'm1', date: '2026-02-01', domicile: 'THUNDER ROCK DIAMANT', visiteur: 'etoile', provenance: { ...OK, espaceNoms: 'CTOS' } }],
  };
  const r = chargerReel(brut, CLUBS);
  expect(r.calendrier.length, 'un match visant un club absent chez nous ne s affiche pas').toBe(0);
  expect(() => chargerReel(brut, CLUBS), 'mais il ne doit pas faire échouer le chargement').not.toThrow();
});

test('une correspondance vers un teamId inexistant est refusée', () => {
  const brut = { correspondances: [corr('X', 'club-qui-n-existe-pas')] };
  expect(() => chargerReel(brut, CLUBS)).toThrow(/teamId "club-qui-n-existe-pas" inconnu/);
});

test('une correspondance sans provenance est refusée comme le reste', () => {
  const brut = { correspondances: [{ source: 'CTOS', idSource: 'X', teamId: 'etoile' }] };
  expect(() => chargerReel(brut, CLUBS)).toThrow(/provenance absente/);
});
