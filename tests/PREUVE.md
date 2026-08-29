# Preuve que les contrôles mordent

Un contrôle qui n'a jamais échoué n'est pas un contrôle. Pour chacun, on
réinjecte le bug qu'il est censé attraper et on montre le rouge. Sorties
verbatim, pas des résumés.

Reproduire : `bash tests/preuve.sh`

## 1. Empilement du fond (`z-index: -1` remis à `0`)

```
✘ thème dark  › les titres de section sont présents et ont une hauteur non nulle
✘ thème light › les titres de section sont présents et ont une hauteur non nulle
  Error: titre "Records de la saison" recouvert par p4t-backdrop-scrim
```

**Ce contrôle a d'abord été écrit faux.** Sa première version testait la présence
et la hauteur des titres, et elle **passait** sur le bug qu'elle devait attraper :
un titre recouvert par un calque opaque garde sa hauteur. C'était un contrôle
mort. Il teste maintenant le recouvrement réel, au centre du titre, via
`elementFromPoint`.

C'est l'intérêt de cette page : sans elle, un contrôle décoratif serait parti en
production en se faisant passer pour une garantie.

## 2. Titre du héros suivant le thème (`color: #F6F0E4` remis à `var(--ink)`)

```
1 failed  thème light › le titre du héros contraste avec son fond
1 passed  thème dark
```

Le thème sombre passe, ce qui est correct : le bug n'existe qu'en thème clair,
où l'encre sombre se pose sur une photo sombre. Un contrôle qui échouerait dans
les deux serait suspect.

## 3. Carte de partage reprenant les jetons du thème (palette locale retirée)

```
1 failed  thème light › la carte de partage contraste avec son propre fond
1 passed  thème dark
```

Même asymétrie, même raison. Cette carte part circuler seule dans un fil de
discussion, sans le site autour : c'est le canal que la revue de conception
désigne comme le risque principal.

## 4. `var()` sur un contexte canvas (`SHARE.amber` remis à `'var(--amber)'`)

```
1 failed  aucune variable CSS passée à un contexte canvas
```

Contrôle statique sur la source. `ctx.fillStyle` n'accepte pas `var()` :
l'affectation est ignorée en silence et la couleur précédente reste active, donc
le PNG sort avec de mauvaises couleurs sans qu'aucune erreur ne soit levée.

## 5. Bandeau de démonstration retiré (`<DemoBanner />` supprimé)

```
✘ thème dark  · le bandeau de démonstration est visible
✘ thème light · le bandeau de démonstration est visible
```

Ce contrôle n'existe pas pour vérifier qu'un composant est monté. Il existe
parce que sans ce bandeau, le site attribue publiquement à des clubs réels des
défaites fabriquées. Sa disparition ne doit jamais être silencieuse.

Il teste aussi la **lisibilité**, pas seulement la présence : un bandeau présent
mais invisible ne dit rien à personne.

## 6. Tampon retiré du PNG généré (`stampDemo(...)` supprimé)

```
✘ le PNG de partage porte le tampon de démonstration
```

Le contrôle télécharge réellement la carte, relit le fichier, et compte les
pixels de la couleur d'alerte dans la bande basse. Il ne se contente pas de
vérifier l'aperçu à l'écran : c'est le PNG qui part circuler seul dans un fil de
discussion, sans le site autour et donc sans le bandeau.

## Ce que ces contrôles ne couvrent pas

À dire, sinon la liste ci-dessus se lit comme une garantie qu'elle n'est pas.

- **Aucun appareil réel.** Ni téléphone milieu de gamme, ni iOS Safari. Un
  navigateur sans interface sur un portable ne dit rien du décodeur d'un
  téléphone. C'est l'issue #5, et elle n'est pas automatisable ici.
- **Aucune mesure de performance.** Le `backdrop-filter` sur des dizaines de
  cartes n'est pas profilé.
- **Aucun contrôle de contenu.** Les tests ne savent pas que les données sont
  fabriquées, ni qu'une affirmation produit est fausse. Ils vérifient qu'on voit
  ce qui est écrit, pas que ce qui est écrit est vrai. Les issues #1, #2 et #3
  ne peuvent pas être fermées par cette CI.
