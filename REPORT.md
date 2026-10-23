# Rapport de développement

## 23 octobre 2026 — Maquette frontend du studio

### Périmètre réalisé

Création de six pages Angular : Accueil, Mes projets, Studio, Bibliothèque, Collaborations et Publications. Navigation commune avec indication de la page active et chargement différé des nouvelles pages. Les anciennes routes des TP sont conservées.

Le studio présente une timeline de quatre pistes fictives et trois panneaux consultables : Piano roll, Mixeur et Effets. La bibliothèque, les projets, les collaborateurs et les publications utilisent des données de démonstration. Les actions métier sont désactivées : aucune lecture audio, permission microphone, sauvegarde, invitation, publication ou requête métier n’a été ajoutée.

### Choix de présentation

Interface sombre et accent vert, illustrations réalisées en CSS sans téléchargement d’images ni nouvelle dépendance. Les composants conservent leurs fichiers TypeScript, HTML et CSS séparés ; les styles visuels communs sont regroupés dans `frontend-starter/src/styles.css`. Les projets fictifs partagés entre pages sont centralisés dans un fichier de données.

Navigation horizontale sur mobile, cartes empilées, panneaux adaptés à la largeur et défilement local de la timeline. Focus visible, lien d’évitement, noms accessibles et commandes non disponibles signalées comme désactivées.

### Vérifications réellement effectuées

- Build Angular réussi avec Node 24.19.0 ; aucun avertissement après retrait des imports inutilisés. Bundle initial estimé à environ 120 ko transférés, incluant l’application existante.
- Tests frontend existants : 7 réussis sur 7, dans 2 fichiers. Ces tests couvrent les anciens comportements ; ils ne constituent pas des tests automatisés des nouvelles pages.
- Navigation contrôlée dans le navigateur vers les six pages ; ouverture des panneaux Mixeur et Effets du studio vérifiée.
- Rendu de l’accueil sur ordinateur et des publications sur mobile inspecté. Studio contrôlé avec des largeurs de 360 et 768 pixels : pas de débordement horizontal du document, timeline défilante dans son conteneur.
- Aucun avertissement ni erreur dans les journaux du navigateur lors de ce parcours.
- `git diff --check` vérifié.

### Limites

Il s’agit uniquement d’une maquette navigable, sans moteur audio ni connexion aux données réelles pour les nouvelles pages. Les réglages et formes d’onde sont illustratifs. Les contrôles manuels ne constituent pas un audit complet d’accessibilité ; le zoom navigateur à 200 % n’a pas été vérifié.

Le Node par défaut du terminal (24.13.1) est refusé par la CLI installée. Pour reproduire les vérifications, utiliser une version compatible, comme Node 24.19.0 employé ici. Le build a nécessité une exécution hors sandbox, où le processus était interrompu ; le serveur local a également nécessité l’autorisation d’écouter sur le port 4200.


## 23 octobre 2026 — Refonte à partir de la référence Music Producer

La première direction visuelle a été remplacée à la demande de l’utilisateur. La version actuelle reprend une esthétique de studio : fond presque noir, typographie blanche en grandes capitales, métadonnées monospace et touches d’ambre. La navigation latérale a été remplacée par un en-tête avec menu repliable sur mobile.

L’accueil comporte une photographie de studio, une waveform décorative animée, un bandeau de genres, les sessions de démonstration, trois parcours de création et une section collaborative. Les cinq autres pages reprennent les nouveaux styles. Aucun moteur audio ni nouveau service métier n’a été ajouté. La waveform n’est pas une mesure audio et les indications de session sont illustratives.

Les animations reposent sur CSS, avec une version sans animation pour `prefers-reduced-motion`. Les polices sont locales ; aucune bibliothèque React, animation ou icônes n’a été ajoutée. Le projet conserve Angular.

### Ressources visuelles et polices

- Photo de studio : [fichier Unsplash utilisé](https://images.unsplash.com/photo-1598488035139-bdbb2231ce04), copie optimisée de 1600 px (environ 273 ko), sous [licence Unsplash](https://unsplash.com/license).
- Polices Bebas Neue, DM Sans et JetBrains Mono, récupérées via Google Fonts et stockées dans `frontend-starter/public/fonts/`. Les licences SIL Open Font License correspondantes sont jointes dans ce dossier.
- Pochettes abstraites et waveform produites en CSS ; aucune couverture d’album externe.

### Vérifications de cette refonte

- Les 7 tests frontend existants passent ; aucune nouvelle logique métier testée n’a été introduite.
- Navigation vers les six pages vérifiée sur ordinateur et à 360 px ; ouverture du menu mobile et fermeture lors de la navigation contrôlées.
- Largeur du document égale à la largeur du viewport pour les six pages à 360 px et sur ordinateur à 1440 px ; studio également vérifié à 768 px.
- Aucun message d’erreur ou d’avertissement dans les journaux du navigateur pendant le parcours vérifié.
- Le contrôle visuel ne remplace pas un audit complet d’accessibilité. Le zoom navigateur à 200 % n’a pas été vérifié.
