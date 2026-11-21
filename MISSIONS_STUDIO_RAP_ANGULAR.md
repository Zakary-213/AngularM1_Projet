# 🎚️ RAP STUDIO — Cahier des missions

> **Projet Angular / Node.js / MongoDB**  
> **Version :** 1.0 · **Date :** 23 octobre 2026  
> **Objectif :** créer des prods de rap, importer une instrumentale et enregistrer sa voix dessus avec correction de justesse (*effet Auto-Tune*).

---

## 🎯 1. Vision du projet

Construire un **studio de production musicale dans le navigateur**, inspiré du fonctionnement des logiciels de MAO : composition avec des instruments, arrangement sur une timeline, écoute immédiate, enregistrement vocal, correction de hauteur, sauvegarde et export audio.

### Les 2 parcours utilisateur

| 🎹 Créer une prod | 📥 Importer une prod |
|---|---|
| Partir d'un projet vide | Charger une instrumentale MP3/WAV |
| Ajouter drums, 808, piano, synthés et samples | Visualiser la forme d'onde de l'instrumentale |
| Programmer des rythmes et écrire des mélodies | Modifier son volume et son égalisation |
| Arranger des clips sur la timeline | Placer l'instrumentale sur la timeline |
| Écouter et sauvegarder à chaque étape | Écouter et sauvegarder le projet |
| **Puis : enregistrer sa voix, appliquer une correction vocale, mixer, exporter** | **Puis : enregistrer sa voix, appliquer une correction vocale, mixer, exporter** |

**Principe d'architecture : un seul studio commun.** Les deux parcours ouvrent le **même éditeur multipiste** ; seul le contenu initial du projet change.

```mermaid
flowchart TD
    A[Accueil / Mes projets] --> B{Nouveau projet}
    B --> C[Créer une prod]
    B --> D[Importer une prod]
    C --> E[Studio multipiste]
    D --> E
    E --> F[Enregistrer des voix]
    F --> G[Correction de hauteur / Auto-Tune]
    G --> H[Mixage et export]
    E --> I[Sauvegarder et reprendre le projet]
```

### ✅ Inclus dans ce projet

- Composition de prods : **drums, 808, instruments, mélodies, patterns et arrangements**.
- Import et lecture d'une instrumentale **MP3/WAV**.
- **Timeline multipiste**, lecture synchronisée, édition de clips.
- **Mixer** : volumes, mute/solo, panoramique, égaliseur et quelques effets.
- **Enregistrement vocal**, plusieurs prises et synchronisation.
- **Correction de hauteur de la voix après enregistrement**, réglable (*effet de type Auto-Tune*).
- **Sauvegarde** des projets éditables et **export** du morceau final.

### ⛔ Hors périmètre pour cette version

- Génération automatique d'instrumentales par IA (l'assistant d'écriture de paroles de **M12** ne génère que du texte).
- Suppression/séparation de la voix d'un rappeur sur un morceau existant.
- Clonage de voix, imitation d'artistes, plateforme sociale et collaboration en temps réel.
- Reproduction complète d'un logiciel commercial comme FL Studio.
- Auto-Tune **en direct pendant la prise** : la V1 applique la correction **après** l'enregistrement.

---

## 🧭 2. À quoi doit ressembler le studio ?

L'interface doit être **riche mais progressive** : les panneaux s'ouvrent selon l'action, plutôt que de tout afficher en permanence.

| Zone de l'écran | Éléments | Actions principales |
|---|---|---|
| **Haut — Transport** | ▶ Lecture, ■ Stop, ● Enregistrer, BPM, métronome, position | Écouter, mettre en boucle, enregistrer |
| **Gauche — Bibliothèque** | Drums, 808, instruments, samples, fichiers importés | Préécouter et ajouter un son |
| **Centre — Timeline** | Pistes et clips colorés, repères de mesures | Placer, déplacer, dupliquer, couper, sélectionner |
| **Bas — Éditeur contextuel** | Drum Rack / Piano Roll / Mixer | Éditer le contenu de la piste sélectionnée |
| **Côté — Inspecteur** | Volume, panoramique, EQ, effets | Régler l'élément sélectionné |
| **Haut droit** | État de sauvegarde, bouton Exporter | Conserver le projet ou produire un fichier audio |

**Ergonomie attendue :** interface pensée d'abord pour ordinateur ; zoom horizontal, panneau inférieur repliable, raccourcis clavier essentiels et couleurs distinctes par piste.

### Les commandes à ne pas confondre

| Commande | Résultat |
|---|---|
| **▶ Écouter** | Rend audible le projet en cours **sans** l'exporter |
| **💾 Sauvegarder** | Conserve les notes, clips, réglages, voix et références de fichiers pour les **rééditer plus tard** |
| **⬇ Exporter** | Génère un **fichier audio final** (WAV d'abord ; MP3 si possible) |

---

## 🏗️ 3. Architecture technique envisagée

| Couche | Outils envisagés | Responsabilité |
|---|---|---|
| Frontend | **Angular + TypeScript** | Pages, composants et état du studio |
| Backend | **Node.js + Express** | API, contrôle des droits, upload, sauvegarde |
| Données | **MongoDB + Mongoose** | Utilisateurs, projets, pistes, patterns, réglages |
| Moteur musical | **Tone.js + Web Audio API** | Timing musical, instruments, lecture et effets |
| Formes d'onde | **WaveSurfer.js** ou rendu personnalisé | Représentation des pistes audio |
| Microphone | **getUserMedia + MediaRecorder** | Capture de voix |
| Correction de hauteur | **Moteur dédié à sélectionner et tester** | Détection et modification de la hauteur des notes vocales |
| Paroles IA | **API d'un modèle de langage, appelée uniquement par le backend** | Proposition de couplets selon le thème et la cadence |
| Export | **OfflineAudioContext et/ou FFmpeg** | Assemblage, rendu, conversion |
| Stockage audio | Fichiers sur serveur (ou stockage objet ultérieur) | Instrumentales importées, voix, échantillons |

> [!IMPORTANT]
> Un véritable effet de correction vocale type Auto-Tune **ne se résume pas à déplacer la hauteur d'un fichier**. Il faut évaluer très tôt un moteur adapté, sa qualité, sa latence, sa licence et son intégration. Ne pas promettre une correction professionnelle avant ce test de faisabilité.

### Modèle de données simplifié

```text
User
└── MusicalProject
    ├── id, ownerId, title, createdAt, updatedAt
    ├── bpm, timeSignature
    ├── tracks[]
    │   ├── type : drum | instrument | audio | vocal
    │   ├── instrument / sample / audioFileId
    │   ├── volume, pan, mute, solo, effects[]
    │   └── clips[] : start, duration, offset, patternId / audioFileId
    ├── patterns[]
    │   ├── drumSteps[]
    │   └── midiNotes[] : pitch, start, duration, velocity
    ├── recordings[] : fileId, position, pitchSettings
    └── masterSettings
```

Les données de projet sont stockées en base. **Les octets des MP3/WAV/enregistrements sont stockés séparément**, et leurs identifiants sont référencés dans MongoDB. Le moteur audio et la timeline travaillent à partir **d'une même horloge musicale**.

---

# 📋 4. Missions de développement

> Ordre recommandé : **valider le moteur audio et la correction vocale**, construire le studio, puis développer les deux parcours sur une base commune.

## M0 · Cadrage et prototypes techniques

**But :** vérifier les choix les plus risqués avant de construire toute l'interface.

- [x] Créer les dossiers `frontend` / `backend` et le dépôt Git.
- [x] Définir les modèles, les routes API et le format de sauvegarde d'un projet.
- [ ] Tester la lecture de **deux sources audio synchronisées** avec Tone.js/Web Audio API.
- [ ] Tester un **séquenceur simple au BPM choisi** et l'écoute en boucle.
- [ ] Tester l'accès au microphone et le rendu d'une prise séparée de la prod.
- [x] Réaliser un **prototype de correction de hauteur sur un court fichier vocal**.
- [x] Comparer les options de rendu/export et leurs limites.
- [x] Vérifier les licences des moteurs, instruments et samples retenus.

**Livrable :** démo technique audio + schéma d'architecture + choix documentés.

**Critère de validation :** au moins deux pistes jouent ensemble de façon cohérente ; une prise vocale test est enregistrée ; une piste corrigée peut être réécoutée (ou une limitation technique est documentée et traitée avant de figer le périmètre).

---

## M1 · Comptes et bibliothèque de projets

**But :** retrouver son travail d'une session à l'autre.

- [x] Inscription et connexion avec validations.
- [x] Authentification JWT et routes backend protégées.
- [x] Page **Mes projets** : créer, ouvrir, renommer, supprimer.
- [x] Nouveau projet : **« Créer une prod »** ou **« Importer une prod »**.
- [x] Sauvegarder les paramètres de base (nom, BPM, date, propriétaire).
- [x] Vérifier l'isolation des projets entre utilisateurs.

**Livrable :** compte utilisateur + liste de projets persistants.

**Critère de validation :** après déconnexion/reconnexion, les projets réapparaissent, sans accès possible aux projets d'un autre compte.

---

## M2 · Structure de l'interface et transport

**But :** disposer du studio commun aux deux parcours.

- [ ] Créer l'écran Studio : transport, bibliothèque, timeline, éditeur inférieur, inspecteur.
- [x] Intégrer **Play, Pause, Stop, position courante, BPM, métronome**.
- [x] Afficher des pistes avec titre, couleur, mute/solo et volume.
- [ ] Permettre l'ajout, la sélection, le renommage et la suppression d'une piste.
- [ ] Ajouter zoom horizontal, défilement, règles de mesures et sélection de position.
- [x] Prévoir le passage entre **Drum Rack, Piano Roll et Mixer**. *(onglets Batterie, Piano Roll, Mixeur sous la timeline)*
- [ ] Afficher l'état de sauvegarde et le bouton Export.

**Livrable :** éditeur utilisable avec transport et pistes, même avant l'implémentation complète des outils.

**Critère de validation :** les contrôles du transport pilotent **un seul moteur audio central**, et non plusieurs lecteurs indépendants.

---

## M3 · Composition : bibliothèque et Drum Rack

**But :** composer un vrai rythme de rap.

- [x] Intégrer une première bibliothèque **autorisée** de kick, snare, clap, hi-hat et percussions. *(sons synthétisés en code : aucune licence de sample à gérer)*
- [x] Ajouter des samples **808 / basses** et des sons de préécoute. *(808 synthétisée, accordée sur la tonalité ; deux kits : boom bap et trap)*
- [x] Créer un **séquenceur de 16 pas** avec instruments par ligne.
- [x] Programmer, désactiver et déplacer des frappes.
- [x] Gérer la vélocité élémentaire et le BPM.
- [x] Mettre un pattern en **boucle avec lecture immédiate**.
- [x] Créer, dupliquer, modifier et supprimer des patterns.
- [x] Sauvegarder les patterns dans le projet.

**Livrable :** Drum Rack opérationnel avec plusieurs kits/samples.

**Critère de validation :** le rythme est audible et synchronisé ; le pattern est identique après sauvegarde et réouverture.

---

## M4 · Composition : Piano Roll et instruments

**But :** ajouter des mélodies et des lignes de basse, pas seulement des drums.

- [x] Ajouter au moins un **piano**, un **synthétiseur** et une **basse 808 jouable par notes**. *(synthétisés en Web Audio, sans sample ; même code à l'écoute et à l'export)*
- [x] Créer le **Piano Roll** : hauteur des notes en vertical, temps en horizontal.
- [x] Ajouter des notes ; les déplacer, redimensionner et supprimer. *(souris, et alternative clavier)*
- [x] Pouvoir jouer plusieurs notes en même temps sur un instrument polyphonique.
- [x] Permettre la lecture immédiate et en boucle de la mélodie. *(note entendue à la pose, « Écouter en boucle », modifications entendues pendant la lecture)*
- [x] Associer chaque pattern à son instrument, son son et ses paramètres. *(instrument, brillance, relâchement, longueur de 1, 2 ou 4 mesures)*
- [x] Enregistrer les notes, durées et vélocités (données de type MIDI). *(sauvegardées avec le projet et validées par le serveur)*

> Vérifié par les tests, l'analyse de l'export WAV et la programmation des notes dans le navigateur ; la qualité sonore et la synchronisation **à l'oreille** restent à confirmer par l'équipe.

**Livrable :** composition d'une mélodie et d'une basse par édition de notes.

**Critère de validation :** l'utilisateur peut créer une courte prod **drums + basse + mélodie** et l'écouter correctement.

---

## M5 · Timeline et arrangement de la prod

**But :** passer de petites boucles à un morceau structuré.

- [x] Afficher les patterns et les fichiers audio sous forme de **clips**.
- [x] Placer et déplacer des clips sur la timeline.
- [x] Dupliquer, raccourcir et supprimer des clips. *(clips de batterie ; l'instrumentale et les prises se retirent depuis leur panneau, sans découpe)*
- [x] Répéter des patterns pour construire intro, couplet, refrain et outro.
- [x] Jouer depuis une mesure ou une position sélectionnée.
- [x] Ajouter une plage de lecture en boucle.
- [x] Prévoir **Annuler / Rétablir** pour les modifications essentielles.
- [x] Conserver exactement les positions de clips lors de la sauvegarde.

**Livrable :** éditeur d'arrangement multipiste.

**Critère de validation :** la prod complète joue de manière synchronisée et les placements sont restaurés à l'identique après réouverture.

---

## M6 · Importation d'une instrumentale existante

**But :** ouvrir un projet directement à partir d'un beat déjà terminé.

- [x] Choisir un fichier **MP3 ou WAV**.
- [x] Valider format, taille, absence de fichier et erreurs d'import.
- [x] Uploader via une API protégée et afficher la progression.
- [x] Conserver le fichier et ses métadonnées dans le stockage.
- [x] Créer automatiquement une piste **Instrumentale** sur la timeline.
- [ ] Afficher une **forme d'onde**, écouter, naviguer et régler le niveau sonore. *(forme d'onde, écoute et niveau faits ; navigation par clic sur la timeline restante)*
- [x] Ajouter un égaliseur **graves / médiums / aigus** sur la piste importée.
- [x] Sauvegarder la position et les réglages de la piste.
- [x] Autoriser l'ajout ultérieur de pistes vocales dans le même projet.

> [!NOTE]
> Sur un MP3/WAV déjà mixé, augmenter les basses agit sur **l'ensemble des fréquences graves**. On ne peut pas régler séparément chaque instrument d'origine sans disposer des pistes sources ; cette séparation est hors périmètre.

**Livrable :** parcours « Importer une prod » dans le studio commun.

**Critère de validation :** après réouverture, l'audio importé et ses réglages restent disponibles.

---

## M7 · Mixer, égaliseur et effets de base

**But :** travailler le son de la prod et des voix avec des réglages indépendants.

- [x] Volume distinct pour chaque piste et volume **Master**.
- [x] **Mute** et **Solo** indépendants.
- [x] Réglage de **panoramique** gauche/droite.
- [x] Égaliseur simple (graves, médiums, aigus) par piste.
- [x] Ajouter **réverbération** et **delay** activables.
- [x] Afficher un indicateur de niveau et signaler les saturations manifestes.
- [x] Conserver les paramètres de mixage après sauvegarde.
- [x] Assurer que les effets entendus sont pris en compte dans l'export.

**Livrable :** panneau Mixer fonctionnel.

**Critère de validation :** modifier le volume ou les effets d'une piste produit un changement audible **sans altérer le fichier original**.

---

## M8 · Enregistrement vocal multipiste

**But :** poser sa voix sur une prod créée ou importée.

- [x] Demander l'autorisation d'accéder au microphone.
- [x] Sélectionner le microphone si plusieurs entrées sont disponibles.
- [x] Prévoir une piste vocale et un bouton **● Record**.
- [x] Jouer la prod au casque pendant l'enregistrement.
- [x] Enregistrer la voix sur une **piste indépendante**.
- [x] Stopper l'enregistrement et afficher sa **forme d'onde**.
- [x] Réécouter immédiatement **prod + voix**.
- [x] Effectuer plusieurs prises ; supprimer et recommencer une prise.
- [x] Déplacer ou décaler une prise pour corriger une éventuelle latence.
- [x] Sauvegarder les prises et conserver les originaux.
- [x] Gérer un refus de permission ou un micro indisponible.

**Livrable :** piste(s) vocales enregistrées et synchronisées.

**Critère de validation :** l'utilisateur peut rapper sur une prod, réécouter le résultat, déplacer sa prise et retrouver son enregistrement en rouvrant le projet.

---

## M9 · Correction vocale de type Auto-Tune

**But :** corriger la hauteur des notes d'une prise vocale enregistrée, avec des réglages adaptés au rap mélodique.

### A. Moteur de correction

- [ ] Choisir le moteur à partir des essais réalisés en **M0**.
- [ ] Détecter ou estimer la hauteur des passages vocaux.
- [ ] Appliquer une correction **sans modifier volontairement la durée totale de la prise**.
- [ ] Préserver la version originale et produire une version corrigée, ou un rendu dérivé réutilisable.
- [ ] Gérer le temps de traitement, les erreurs et les voix difficiles à corriger.

### B. Interface utilisateur

- [ ] Ajouter **Auto-Tune : Activé / Désactivé** dans les effets de la piste vocale.
- [x] Choisir une **tonalité** (ex. La mineur) et une **gamme**.
- [x] Régler l'intensité et, **si le moteur le permet**, la vitesse de correction.
- [x] Proposer des préréglages **Naturel** et **Effet marqué**.
- [x] Comparer **Avant / Après** sur la même prise.
- [ ] Enregistrer les réglages de correction.
- [ ] Inclure la version corrigée dans l'export audio.

### C. Extension : préréglages par style et mode personnalisé

**But :** rendre la correction vocale utilisable sans connaître la théorie : l'utilisateur choisit un **style** en un clic, l'écoute, puis affine seulement s'il le souhaite.

**Interface en deux niveaux**

- [x] **Niveau simple (par défaut)** : une rangée de cartes de style, un seul bouton rotatif **« Dose d'effet »** (0 à 100 %, qui pilote ensemble intensité et vitesse dans les proportions du style), la tonalité du projet reprise automatiquement, et un bouton **Avant / Après**.
- [x] Chaque carte affiche une phrase d'explication (« voix juste mais naturelle », « effet robotique assumé »…) et se prévisualise sur la prise courante avant d'être appliquée.
- [x] **Niveau avancé (repliable)** : tous les réglages du style choisi, modifiables ; toute modification bascule sur **« Personnalisé (basé sur Trap) »** au lieu d'écraser le préréglage.
- [ ] Bouton **Réinitialiser le style** et possibilité d'**enregistrer son propre préréglage** avec le projet.
- [x] Afficher la courbe de hauteur (détectée et corrigée) sur la durée de la prise, pour voir où la voix est recalée.

**Préréglages de style (valeurs de départ, à ajuster à l'écoute)**

| Style | Intention | Intensité | Vitesse de recalage | Gamme suggérée | Spectre / couleur |
|---|---|---|---|---|---|
| **Naturel** | Voix juste, effet inaudible | 40–60 % | lente (80–120 ms) | celle du projet | aucun changement |
| **Rap** | Couplets parlés-rappés, juste un « lissage » | 20–40 % | lente (100–150 ms) | celle du projet | coupe-bas, léger gain de présence |
| **Trap** | Effet marqué et mélodique | 100 % | instantanée (0–10 ms) | mineure | présence et « air » renforcés |
| **Drill** | Voix sombre, correction discrète | 30–50 % | moyenne (40–60 ms) | mineure | bas-médiums accentués, aigus adoucis |
| **Raï** | Voix de chanteur de raï : correction très présente qui « glisse » vers la note, timbre aigu et brillant, grande réverbération et écho répété | 90–100 % | rapide mais pas instantanée (15–30 ms) | **mineure harmonique** ou **phrygien dominant** (Hijaz) | bas-médiums réduits, présence et air forts ; réverbération longue (≈ 3 s) et écho à la croche avec plusieurs répétitions |
| **Robot** | Effet extrême, sauts de notes nets | 100 % | 0 ms | celle du projet | inchangé |
| **Personnalisé** | Tous les réglages libres | — | — | — | — |

**Réglages du mode avancé / personnalisé**

- [x] Tonalité, gamme (ajouter **mineure harmonique** et **phrygien dominant** aux gammes majeure et mineure) et **notes autorisées** cochables une par une.
- [x] Intensité, vitesse de recalage et **naturel / humanisation** (tolérance en cents avant correction, pour garder les petites variations et le vibrato).
- [x] **Spectre de la voix** : égaliseur simple (coupe-bas, corps, présence, air) appliqué à la piste corrigée.
- [x] **Espace** : réverbération (niveau, taille de salle) et écho (niveau, temps calable sur le tempo, répétitions), dosés par le style et la dose d'effet.
- [x] **Formants / timbre** (voix plus grave ou plus claire sans changer la note) **uniquement si le moteur retenu le permet** : le PSOLA actuel ne préserve pas les formants (voir la limite notée en M0) ; sinon documenter la limite et masquer le réglage.
- [x] Transposition volontaire (± 12 demi-tons), clairement distinguée de la correction.

**Contraintes**

- [x] Les préréglages sont des **données** (nom, description, valeurs) dans un seul fichier, testées unitairement (bornes, gammes, valeurs par style).
- [x] La prise originale n'est jamais modifiée ; changer de style recalcule la version corrigée.
- [ ] Le traitement d'une prise longue ne bloque pas l'interface (état « calcul en cours », possibilité d'annuler).
- [x] Accessible au clavier : cartes de style = boutons radio, réglages avec labels et valeur lue (« 70 % », « 40 ms »).
- [x] Les noms de style décrivent un rendu, pas un artiste : ne pas citer ni imiter la voix d'un artiste existant.

**Critère de validation de l'extension :** sur une même prise, l'utilisateur passe d'un style à l'autre et entend la différence en un clic ; il peut personnaliser un style, l'enregistrer avec le projet et le retrouver à la réouverture.

> [!WARNING]
> **Auto-Tune** est aussi une marque commerciale. Dans le projet, utiliser « correction de hauteur vocale » ou « effet de type Auto-Tune » tant qu'aucune technologie sous cette marque n'est intégrée. Le rendu et la qualité dépendront du moteur effectivement retenu.

**Livrable :** correction vocale **après la prise**, contrôlable depuis le studio.

**Critère de validation :** une prise peut être comparée avant/après, les réglages sont conservés et le mix exporté utilise la version choisie.

---

## M10 · Sauvegarde complète et export audio

**But :** reprendre un projet modifiable et récupérer le morceau final.

### Sauvegarde

- [ ] Sauvegarder pistes, BPM, instruments, patterns, notes, clips, volumes et effets.
- [ ] Sauvegarder les fichiers importés et les prises vocales.
- [ ] Sauvegarder les paramètres de correction vocale.
- [ ] Mettre en place une sauvegarde explicite et, si possible, **automatique**.
- [ ] Indiquer clairement **Modifications non sauvegardées / Sauvegarde en cours / Sauvegardé / Erreur**.
- [ ] Charger un projet et retrouver la même session éditable.

### Export

- [ ] Produire un **mix unique** respectant les positions des clips.
- [ ] Inclure drums, instruments, prod importée, voix et effets actifs.
- [ ] Prendre en compte les volumes, la correction vocale et le Master.
- [ ] Exporter en **WAV** en priorité ; MP3 en complément si disponible.
- [ ] Indiquer la progression ou l'état du rendu.
- [ ] Permettre le téléchargement du fichier final.

**Livrable :** sauvegarde/rechargement fiable + export audible hors de l'application.

**Critère de validation :** un projet sauvegardé s'ouvre sans perte majeure ; l'export ressemble au mix entendu dans le studio et ses pistes sont synchronisées.

---

## M11 · Tests, stabilité et livraison

**But :** prouver que les deux parcours fonctionnent de bout en bout.

- [ ] Tester l'authentification et les droits d'accès aux projets.
- [ ] Tester les requêtes backend et les formats de fichiers refusés.
- [ ] Tester la programmation de drums et notes, avec sauvegarde/réouverture.
- [ ] Tester la synchronisation de plusieurs pistes et le changement de BPM.
- [ ] Tester les déplacements et duplications de clips.
- [ ] Tester l'import MP3/WAV et les messages d'erreur.
- [ ] Tester l'enregistrement avec et sans permission microphone.
- [ ] Tester la correction vocale et la comparaison avant/après.
- [ ] Tester la persistance des réglages et des prises vocales.
- [ ] Vérifier la qualité et le timing des exports audio.
- [ ] Ajouter des tests unitaires Angular et tests API pertinents.
- [ ] Exécuter les builds, documenter l'installation et préparer une démonstration.

**Livrable :** application testée + guide de lancement + scénario de démonstration.

---

## M12 · Assistant d'écriture de paroles par IA

**But :** aider l'artiste à démarrer ou débloquer un texte en générant des paroles adaptées au **thème** choisi et à la **cadence** de la prod.

### A. Paramètres de génération

- [ ] Saisir un **thème** (ex. « la nuit en ville », « revanche », « famille ») et une **ambiance** (sombre, mélancolique, ego-trip, festive…).
- [ ] Reprendre automatiquement le **BPM**, la **signature rythmique** et la **tonalité** du projet.
- [ ] Choisir la structure : **couplet / refrain / pont**, et le nombre de **mesures** (4, 8, 16).
- [ ] Choisir la **densité du flow** (syllabes par temps : posé, standard, rapide) et le **schéma de rimes** (AABB, ABAB, rimes internes).
- [ ] Choisir la langue (français par défaut) et un niveau de langage.

### B. Génération côté serveur

- [ ] Créer une route protégée `POST /api/projects/:id/lyrics/generate` : le **backend** appelle le fournisseur d'IA, **la clé d'API ne transite jamais par le navigateur**.
- [ ] Valider et borner chaque entrée (longueur du thème, mesures, options autorisées).
- [ ] Construire la consigne envoyée au modèle à partir du thème et de la cadence calculée : **nombre de syllabes visé par mesure** dérivé du BPM et de la densité choisie.
- [ ] Demander une réponse **structurée** (lignes regroupées par mesure, syllabes estimées, rimes) et la valider avant de la renvoyer.
- [ ] Limiter le nombre de générations par utilisateur et par jour (**coût et abus**), gérer délai dépassé, quota et indisponibilité du fournisseur avec un message clair.
- [ ] Refuser les demandes visant à **imiter un artiste réel** ou à reproduire des paroles existantes, et ne pas produire de contenu haineux ou harcelant.
- [ ] Ne pas journaliser les textes ni les thèmes complets ; ne jamais envoyer au fournisseur d'autres données que celles nécessaires.

### C. Interface dans le studio

- [ ] Ajouter un panneau **Paroles** dans l'éditeur inférieur du studio.
- [ ] Afficher les lignes **alignées sur les mesures** de la timeline, avec le compte de syllabes et les rimes surlignées.
- [ ] Permettre de **régénérer une ligne ou un bloc**, d'éditer librement le texte et d'annuler.
- [ ] Faire défiler les paroles pendant la lecture (prompteur) à partir de **l'horloge audio commune**.
- [ ] Indiquer clairement qu'il s'agit d'une **proposition générée par IA** que l'artiste doit retravailler.
- [ ] Sauvegarder les paroles dans le projet (version courante + historique court), sans régénération automatique.

> [!NOTE]
> Le modèle ne « entend » pas la prod : la cadence lui est transmise sous forme de chiffres (BPM, mesures, syllabes visées). Le compte de syllabes reste une **estimation** ; l'artiste ajuste le texte à son flow réel lors de l'enregistrement (M8).

**Livrable :** panneau Paroles avec génération, édition, prompteur synchronisé et sauvegarde.

**Critère de validation :** pour un thème et un BPM donnés, l'assistant propose un couplet de 8 ou 16 mesures dont la longueur des lignes suit la densité demandée ; le texte est modifiable, sauvegardé avec le projet et défile en rythme pendant la lecture. Une panne ou un quota atteint affiche un message sans bloquer le studio.

---

## 🗂️ 5. Ordre d'exécution conseillé

| Phase | Missions | Ce qu'on peut montrer |
|---|---|---|
| **Fondations** | M0 → M1 → M2 | Connexion, projets, studio, transport |
| **Création musicale** | M3 → M4 → M5 | Une prod complète, écoutable et arrangée |
| **Import et mix** | M6 → M7 | Une prod MP3/WAV importée, réglable et mixable |
| **Voix et correction** | M8 → M9 | Enregistrement vocal et correction de hauteur |
| **Écriture** | M12 | Paroles générées selon le thème et la cadence, éditées et affichées en prompteur |
| **Finalisation** | M10 → M11 | Projet sauvegardé, morceau exporté, tests |

**Dépendance à garder en tête :** **M9 doit être validée techniquement dès M0**, même si son interface finale est réalisée plus tard. C'est la fonctionnalité la plus incertaine du périmètre.

---

## 🎬 6. Démonstration finale attendue

### Parcours A — Création de prod

1. Se connecter et créer un projet « Nouvelle prod ».
2. Fixer le BPM, choisir un kit de drums et écrire un rythme.
3. Ajouter une basse 808 et une mélodie au Piano Roll.
4. Écouter les éléments ensemble et construire l'arrangement sur la timeline.
5. Ajuster les niveaux/effets et sauvegarder.
6. Générer un couplet avec l'assistant de paroles à partir d'un thème, l'ajuster, puis l'enregistrer au micro en suivant le prompteur ; créer une deuxième prise si nécessaire.
7. Appliquer la correction vocale et comparer le résultat.
8. Exporter en WAV, puis rouvrir le projet pour prouver qu'il reste modifiable.

### Parcours B — Import de prod

1. Créer un projet « Importer une prod ».
2. Charger un MP3/WAV et observer sa forme d'onde.
3. Ajuster le volume et l'égaliseur de l'instrumentale.
4. Enregistrer une voix par-dessus, repositionner la prise si nécessaire.
5. Activer la correction vocale et mixer.
6. Sauvegarder le projet et exporter le morceau final.

---

## ✅ 7. Définition de « projet terminé »

- [ ] Une prod peut être **créée**, avec drums, basse et mélodie.
- [ ] Elle peut être **écoutée à tout moment**, mise en boucle et arrangée sur une timeline.
- [ ] Une prod MP3/WAV peut être **importée** et réglée.
- [ ] Une voix peut être **enregistrée** sur les deux types de projets.
- [ ] Une correction de hauteur vocale est **audible, réglable et conservée**.
- [ ] Les projets et leurs pistes restent **éditables après sauvegarde et réouverture**.
- [ ] L'utilisateur peut **exporter un morceau final** synchronisé.
- [ ] Des **paroles** peuvent être générées selon le thème et la cadence, éditées et sauvegardées.
- [ ] Les projets privés sont protégés et les principaux parcours sont testés.

---

> **Résumé :** un **studio unique** avec **2 entrées** (composer ou importer), **1 espace vocal commun**, **1 mixer**, **1 sauvegarde éditable** et **1 export audio**. **1 assistant de paroles par IA**. Pas de génération audio par IA ni de séparation de voix dans cette version.
