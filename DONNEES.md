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

**Par défaut, rien n'est fabriqué.** Le site est vrai à l'arrivée et on **opte
pour** la démonstration, jamais l'inverse. Un défaut qui invente oblige à penser
à l'éteindre ; un défaut qui dit la vérité ne peut pas se tromper par oubli, et
c'est le seul sens qui protège les clubs réels.

```
/                         rien de fabriqué   (défaut)
/?faux=on                 tout allumé, mode démonstration
/?faux=fixtures,score     seules ces familles sont allumées
```

Cinq familles : `rosters`, `fixtures`, `score`, `mouvement`, `highlights`.

### Dépendances, qui sont réelles et non des préférences

- `score` ou `mouvement` impliquent `rosters` et `fixtures` : il n'y a pas de
  statistique par joueur sans joueurs, ni de match sans calendrier
- `highlights` implique `rosters` : un temps fort nomme un joueur

Une combinaison impossible est corrigée à la lecture plutôt que de planter plus
bas.

Quand une famille est éteinte, l'interface ne casse pas : elle retombe dans
l'état **« pas encore de captation »** qui existe déjà dans le code de Benoît,
avec le champ ASCII qui marque l'absence de donnée.

## Sept plantages révélés par l'extinction

Tous du même genre : du code qui supposait que la donnée est toujours là. Ils
étaient invisibles parce qu'elle l'était toujours.

| Endroit | Symptôme |
|---|---|
| `ROSTERS[id].map` et `.find`, une dizaine de sites | clé absente au lieu d'un tableau vide |
| `getPlayerOfTheWeek` | `played[0].id` sur une liste vide |
| `getWeeklyFeatured` | fixture absente déréférencée |
| `getSeasonRecords` | `record: null`, puis record au joueur introuvable |
| section joueur de la semaine | rendue sans son contenu |
| `buildLeagueFeed` | `topPlayer.id` sur un joueur absent |
| `MatchCard` | même chose, sur deux cartes |

Un état légitime, pas une anomalie : sans effectif, on sait qu'un match a eu
lieu mais pas qui l'a marqué. L'interface le dit désormais au lieu de planter.

## Ce que l'extinction règle, et ce qu'elle ne règle pas

Elle règle la racine du reproche de la DA et de la revue de conception : plus
aucun club réel ne porte de résultat inventé, et le problème disparaît au lieu
d'être étiqueté par un bandeau.

Elle ne règle pas la **collecte**. Tant que la vraie donnée n'arrive pas, le
site montre une structure vide. C'est honnête, mais ce n'est pas une
démonstration : voir la session parallèle chargée de trouver les sources.
