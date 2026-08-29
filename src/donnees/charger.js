/* =========================================================================
   RECEPTACLE DES DONNEES REELLES

   L interrupteur eteint le faux. Ceci est l endroit ou verser le vrai.

   REGLE UNIQUE, et elle est deliberement penible: aucun enregistrement n entre
   sans PROVENANCE. Pas de source, pas de date de releve, pas de mode: le
   chargement echoue et dit lequel. Une donnee sans provenance est une donnee
   dont personne ne pourra dire, dans six mois, si elle est vraie.

   Ce n est pas de la ceinture et bretelles: ce site a passe la journee a faire
   passer du fabrique pour du reel. La provenance est la seule chose qui
   distingue les deux une fois que le chiffre est affiche.
   ========================================================================= */

const MODES = new Set(['manuel', 'automatique']);

function exigerProvenance(p, ou) {
  if (!p || typeof p !== 'object') throw new Error(`${ou}: provenance absente`);
  if (!p.source) throw new Error(`${ou}: provenance sans source`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.releve || '')) {
    throw new Error(`${ou}: provenance sans date de relevé au format AAAA-MM-JJ`);
  }
  if (!MODES.has(p.mode)) {
    throw new Error(`${ou}: mode "${p.mode}" inconnu, attendu manuel ou automatique`);
  }
  return p;
}

/**
 * Valide et normalise un jeu de donnees reelles.
 * Renvoie { effectifs, calendrier, feuilles, provenances } ou lance.
 *
 * `clubsConnus` sert a refuser un identifiant de club inconnu plutot que de
 * l ignorer en silence: une source qui nomme un club qu on n a pas est une
 * information, pas une ligne a jeter.
 */
export function chargerReel(brut, clubsConnus) {
  if (!brut || typeof brut !== 'object') return vide();
  const connus = new Set(clubsConnus || []);
  const inconnus = new Set();

  /* TABLE DE CORRESPONDANCE, ecrite a la main, jamais devinee.
     Aucune source publique ne donne d identifiant de club commun, et le
     rapprochement par nom casse sur des cas REELS releves par la recherche:
       REBOND PILOTAIN (CTOS)        contre  Le Rebond Pilotin (ici)
       Baloncesto de Floreal (RNA)   contre  USAC de Floréal (ici)
     La commune ne sert pas de cle de secours non plus: Madin Grey est au
     Lamentin au RNA et a Fort-de-France ici.
     Un rapprocheur automatique par prefixe a d ailleurs sorti deux faux
     negatifs des le premier essai. On n en met donc aucun.
     teamId peut valoir null: une entree de source sans equivalent chez nous
     est une information a garder, pas une ligne a jeter. */
  const corr = new Map();
  (brut.correspondances || []).forEach((c, i) => {
    exigerProvenance(c.provenance, `correspondances[${i}]`);
    if (!c.source || !c.idSource) {
      throw new Error(`correspondances[${i}]: source et idSource sont obligatoires`);
    }
    if (c.teamId !== null && c.teamId !== undefined && !connus.has(c.teamId)) {
      throw new Error(`correspondances[${i}]: teamId "${c.teamId}" inconnu`);
    }
    corr.set(`${c.source}::${c.idSource}`, c.teamId ?? null);
  });

  // Resolution: un identifiant de source passe par la table, jamais par une
  // heuristique. S il n y est pas, on le signale comme inconnu.
  //
  // L espace de noms n est PAS forcement la source de l enregistrement: un
  // calendrier repris de la FFBB peut nommer les clubs avec les libelles du
  // CTOS. La provenance peut donc porter `espaceNoms` pour le dire, et a
  // defaut on retombe sur la source.
  const resoudre = (source, id) => {
    if (connus.has(id)) return id;                       // deja un teamId
    const cle = `${source}::${id}`;
    if (corr.has(cle)) return corr.get(cle);             // peut etre null, volontairement
    inconnus.add(id);
    return null;
  };

  const effectifs = {};
  for (const [cle, joueurs] of Object.entries(brut.effectifs || {})) {
    const clubId = connus.has(cle) ? cle : null;
    if (!clubId) { inconnus.add(cle); continue; }
    effectifs[clubId] = (joueurs || []).map((j, i) => {
      exigerProvenance(j.provenance, `effectifs.${clubId}[${i}]`);
      if (!j.nom) throw new Error(`effectifs.${clubId}[${i}]: nom manquant`);
      return {
        id: j.id || `${clubId}-r${i + 1}`,
        name: j.nom,
        number: j.numero ?? null,
        position: j.poste || null,
        provenance: j.provenance,
      };
    });
  }

  const calendrier = (brut.calendrier || []).map((m, i) => {
    exigerProvenance(m.provenance, `calendrier[${i}]`);
    for (const cle of ['id', 'date', 'domicile', 'visiteur']) {
      if (!m[cle]) throw new Error(`calendrier[${i}]: ${cle} manquant`);
    }
    const src = m.provenance.espaceNoms || m.provenance.source;
    const dom = resoudre(src, m.domicile);
    const vis = resoudre(src, m.visiteur);
    return {
      id: m.id,
      date: m.date,
      homeTeamId: dom,
      awayTeamId: vis,
      // null et non 0: un match non joue n a pas un score de zero.
      homeScore: m.scoreDomicile ?? null,
      awayScore: m.scoreVisiteur ?? null,
      provenance: m.provenance,
    };
  // Un match dont un des deux clubs n est pas resolu ne peut pas etre affiche:
  // il serait attribue a personne. Il reste signale via clubsInconnus.
  }).filter((m) => m.homeTeamId && m.awayTeamId);

  const feuilles = (brut.feuilles || []).map((f, i) => {
    exigerProvenance(f.provenance, `feuilles[${i}]`);
    if (!f.matchId) throw new Error(`feuilles[${i}]: matchId manquant`);
    return { matchId: f.matchId, joueurs: f.joueurs || [], provenance: f.provenance };
  });

  return {
    effectifs,
    calendrier,
    feuilles,
    clubsInconnus: [...inconnus],
    compte: {
      effectifs: Object.values(effectifs).reduce((a, l) => a + l.length, 0),
      calendrier: calendrier.length,
      joues: calendrier.filter((m) => m.homeScore != null).length,
      feuilles: feuilles.length,
    },
  };
}

function vide() {
  return {
    effectifs: {}, calendrier: [], feuilles: [], clubsInconnus: [],
    compte: { effectifs: 0, calendrier: 0, joues: 0, feuilles: 0 },
  };
}

/** Les sources distinctes presentes, pour pouvoir les citer a l ecran. */
export function sourcesDe(reel) {
  const s = new Map();
  const ajoute = (p) => { if (p && p.source) s.set(p.source, p); };
  Object.values(reel.effectifs).forEach((l) => l.forEach((j) => ajoute(j.provenance)));
  reel.calendrier.forEach((m) => ajoute(m.provenance));
  reel.feuilles.forEach((f) => ajoute(f.provenance));
  return [...s.values()];
}
