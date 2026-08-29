# Périmètre des données fabriquées

Établi sur pièce, en lisant `src/App.jsx`. Objectif : savoir exactement quoi
éteindre quand la vraie donnée arrive.

## Ce qui est RÉEL aujourd'hui

| Source | Contenu |
|---|---|
| `COMPETITIONS` | 3 compétitions : Régionale 1 et 2 masculines, Pré-nationale féminine |
| `TEAMS` | 30 clubs : noms, communes, salles, compétition |
| `public/logos/` | 15 entrées sur 30, logos fournis par la ligue |

Deux fichiers de l'archive ne correspondent à aucun club et ne sont pas
installés : `LR31 - HORS ASSOCIATION` est le logo de la **LMBB**, donc la ligue
elle-même, et `THUNDER ROCK DIAMANT` est un **club réel absent des 30**.

## Ce qui est FABRIQUÉ, et d'où ça sort

Tout descend de **quatre sources**, et rien d'autre. C'est ce qui rend
l'extinction simple.

| # | Source | Ligne | Produit |
|---|---|---|---|
| 1 | `ROSTERS` | 101 | 300 joueurs : 70 écrits à la main, 230 générés par `buildFictionalRoster` |
| 2 | `FIXTURES` | 349 | calendrier et scores, via `buildDivisionFixtures` |
| 3 | `buildTeamMatches` | 366 | stats par joueur et par match, via `mulberry32` |
| 4 | `HIGHLIGHTS` | 716 | 10 temps forts écrits à la main |

Tout le reste en **dérive** et n'a donc pas besoin d'interrupteur propre :

```
LEAGUE                     <- ROSTERS + buildTeamMatches
buildStandings             <- LEAGUE
getSeasonRecords           <- LEAGUE
getTeamSeasonRecords       <- LEAGUE
buildLeagueFeed            <- FIXTURES + LEAGUE
getPlayerOfTheWeek         <- LEAGUE
getPlayerCareer / Rank     <- LEAGUE
getWeeklyFeatured          <- LEAGUE
```

18 lectures de `LEAGUE` dans le fichier, toutes en aval.

## Les deux familles de statistiques, à ne pas confondre

Benoît les distingue lui-même dans son commentaire d'en-tête, et cette
distinction est structurante pour l'extinction :

| Famille | Origine prévue | Champs |
|---|---|---|
| SCORE | saisie humaine, marqueur à la table | points, tirs à 2 et 3, rebonds, passes, fautes |
| MOUVEMENT | tracking automatique, sans saisie | distance, vitesse max, sprints, touches, temps de jeu |

Le **+/-** est croisé des deux et n'existe que si les deux sont là.

Elles n'arriveront pas en même temps : un club peut avoir une caméra sans
marqueur à la table ce soir-là, ou l'inverse. Elles ont donc chacune leur
interrupteur.

## L'interrupteur

`FAKE` en tête de `src/App.jsx`, une clé par famille :

```js
const FAKE = {
  rosters:    true,   // effectifs inventés
  fixtures:   true,   // calendrier et scores inventés
  score:      true,   // stats de la famille SCORE
  mouvement:  true,   // stats de la famille MOUVEMENT
  highlights: true,   // temps forts inventés
};
```

Surchargeable à l'exécution sans reconstruire, pour pouvoir montrer les deux
états côte à côte :

```
/?faux=off            tout éteint
/?faux=fixtures,score seules ces familles restent allumées
```

Quand une famille est éteinte, l'interface ne casse pas : elle retombe dans
l'état **« pas encore de captation »** qui existe déjà dans le code de Benoît,
avec le champ ASCII qui marque l'absence de donnée.

## Ce que l'extinction règle, et ce qu'elle ne règle pas

Elle règle la racine du reproche de la DA et de la revue de conception : plus
aucun club réel ne porte de résultat inventé, et le problème disparaît au lieu
d'être étiqueté par un bandeau.

Elle ne règle pas la **collecte**. Tant que la vraie donnée n'arrive pas, le
site montre une structure vide. C'est honnête, mais ce n'est pas une
démonstration : voir la session parallèle chargée de trouver les sources.
