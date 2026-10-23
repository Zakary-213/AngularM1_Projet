# Guide de développement — Studio musical collaboratif

Ce fichier s’applique à tout le dépôt, aux étudiants comme aux assistants de programmation. Le but est de produire une application compréhensible, utilisable et démontrable, sans construire une architecture disproportionnée pour un projet étudiant.

## Lecture obligatoire pour tout agent IA

**Avant toute implémentation, correction ou refactorisation, lire intégralement ce fichier.** Cette consigne s’adresse à Codex, Claude Code et à tout autre assistant intervenant dans le dépôt, y compris les agents délégués.

Avant la première modification :

1. Lire ce `AGENTS.md` racine, puis les `AGENTS.md` et `best-practices.md` applicables aux dossiers concernés.
2. Lire la mission demandée, le code existant et les contrats concernés. Ne pas commencer à coder sur la seule base d’un résumé de conversation.
3. Indiquer brièvement à l’utilisateur les consignes lues, les fichiers ou couches concernés et les vérifications prévues. Cette indication ne constitue pas une demande d’autorisation.
4. Appliquer ces règles pendant l’implémentation et vérifier les critères de fin de mission avant d’annoncer le travail terminé.

Si un fichier de consignes requis est absent ou illisible, signaler précisément le problème avant de modifier le code concerné. Ne pas prétendre avoir lu un fichier inaccessible. Après une perte de contexte, relire les consignes si leur contenu n’est plus disponible ou si elles ont changé.

`AGENTS.md` est la référence commune ; les fichiers d’entrée propres aux outils doivent y renvoyer plutôt que dupliquer les règles. Les instructions explicites de l’utilisateur et les instructions de priorité supérieure de l’outil restent prioritaires.

## 1. Comprendre le projet avant de modifier le code

- Le produit est un studio musical dans le navigateur : composition avec instruments, édition multipiste, import et enregistrement audio, BPM, tonalité, effets, sauvegarde, export, publication et travail à plusieurs sur un même projet.
- La collaboration vise le partage des modifications du projet en direct. Jouer ensemble à distance avec une latence musicale faible constitue un sujet distinct qui nécessite une validation technique.
- Procéder par petites fonctionnalités utilisables. Réaliser des prototypes courts pour les risques audio : synchronisation, correction vocale, export et collaboration.
- Ne pas présenter une transposition simple comme une correction automatique de justesse, ni une modification de vitesse comme un changement de tempo préservant la hauteur.
- Lire les fichiers concernés, les `AGENTS.md` et `best-practices.md` du sous-dossier, ainsi que `API_CONTRACT.md`, avant une modification pertinente.
- Conserver la structure existante `frontend-starter/` et `backend/`. Ne pas recréer le projet ou renommer ses dossiers sans nécessité.
- Le cahier `MISSIONS_STUDIO_RAP_ANGULAR.md` exclut encore la collaboration et la plateforme sociale : cette partie doit être alignée avec les demandes de publication et de collaboration avant leur développement. Ne pas supprimer ces objectifs silencieusement.
- Les instructions explicites de l’utilisateur priment. Signaler les contradictions entre documents ; résoudre les choix courants sans demander une validation à chaque étape.

## 2. Code simple et compréhensible

- Choisir des noms explicites et cohérents, en anglais dans le code et en français dans les textes destinés aux utilisateurs.
- Donner une responsabilité claire à chaque fonction, composant et service. Extraire la logique lorsque cela facilite sa compréhension ou son test.
- Séparer interface, logique métier, accès réseau, stockage et moteur audio. Un composant ne doit pas devenir à lui seul tout le studio.
- Préférer la solution la plus simple qui répond au besoin. Ne pas introduire de framework, abstraction générique, microservice ou système de plugins sans cas concret.
- Éviter la duplication réelle sans abstraire prématurément des comportements différents.
- Garder le typage TypeScript strict ; éviter `any`, préférer `unknown` avec validation aux frontières externes.
- Remplacer les valeurs métier dispersées par des constantes nommées : bornes de BPM, taille des fichiers, nombre de pistes, etc.
- Commenter les raisons, unités, contraintes de synchronisation et décisions peu évidentes. Ne pas paraphraser chaque ligne.
- Supprimer le code mort et les imports inutiles dans les fichiers modifiés. Éviter les refactorings et reformatages sans lien avec la mission.
- Ne jamais masquer une erreur avec un `catch` vide ou simuler un succès après un échec.

## 3. Frontend Angular

- Respecter les conventions Angular et les versions effectivement présentes dans le dépôt.
- Utiliser les composants standalone, `inject()`, les Signals pour l’état local et `computed()` pour les valeurs dérivées ; conserver RxJS pour les flux qui le nécessitent.
- Utiliser les Reactive Forms et le contrôle de flux `@if`, `@for`, `@switch` selon les conventions existantes.
- Garder les templates lisibles, avec peu de logique ; utiliser des identifiants stables pour suivre les listes de pistes et de clips.
- Passer par des services pour HTTP et le moteur audio. Garder les modèles partagés explicites et éviter plusieurs sources de vérité pour un même état.
- Nettoyer les abonnements et ressources lors de la destruction d’un composant ou de la fermeture d’un projet.
- Prévoir les états chargement, vide, succès, erreur et modifications non sauvegardées. Bloquer les doubles soumissions et proposer un nouvel essai quand il est possible.

## 4. Interface responsive et accessible

- Le studio est optimisé pour ordinateur, mais l’application reste utilisable sur mobile et tablette : navigation, projets, écoute, publication et accès aux contrôles essentiels.
- Adapter les panneaux, leur ordre et leur visibilité à l’espace disponible. Prévoir des panneaux repliables et des tailles flexibles plutôt que des largeurs fixes partout.
- Autoriser le défilement horizontal à l’intérieur de la timeline lorsque nécessaire ; éviter le débordement horizontal de toute la page.
- Vérifier au minimum une largeur mobile proche de 360 px, une tablette et un écran de bureau, ainsi que le zoom à 200 %.
- Utiliser du HTML sémantique, de vrais boutons, des labels, des messages d’erreur liés aux champs et un focus visible.
- Rendre les actions essentielles utilisables au clavier ; proposer une alternative au glisser-déposer pour déplacer un clip ou modifier sa position.
- Donner un nom accessible aux boutons à icône et aux réglages audio. Ne pas transmettre une information uniquement par la couleur.
- Prévoir des cibles tactiles suffisamment grandes, des contrastes lisibles et le respect de la préférence de réduction des animations.
- Les raccourcis ne doivent pas perturber la saisie dans les champs. Expliquer les raccourcis disponibles.
- Afficher clairement l’état du micro, de l’enregistrement, de la sauvegarde et de la connexion collaborative.

## 5. Application légère et réactive

- Justifier chaque nouvelle dépendance par son utilité, son coût de chargement, sa maintenance et sa licence. Réutiliser l’existant quand il convient.
- Charger à la demande le studio et les modules lourds : instruments, visualisations, correction vocale et conversion audio.
- Ne pas charger tous les samples, projets ou fichiers audio au démarrage. Paginer les listes et ne récupérer que les données nécessaires.
- Éviter les gros fichiers binaires dans Git, les audios encodés en base64 dans les JSON et les copies répétées de buffers.
- Ne pas envoyer le projet entier à chaque déplacement de clip ou chaque mouvement de slider. Regrouper ou limiter les mises à jour et prévoir une sauvegarde différée avec état visible.
- Dessiner uniquement les éléments visibles quand une timeline devient grande. Ne pas déclencher un rendu Angular pour chaque échantillon audio ou image de visualisation.
- Utiliser `requestAnimationFrame` pour les visualisations ; arrêter les animations inutilisées et réduire leur activité lorsque la page est masquée, sans interrompre silencieusement un enregistrement.
- Déporter les calculs lourds hors du thread de l’interface quand nécessaire ; ne pas complexifier le code sans mesure ou problème observé.
- Définir et documenter des limites réalistes de durée, taille et nombre de pistes. Afficher un message clair lorsqu’une limite est atteinte.
- Mesurer sur un projet de démonstration représentatif : taille du build, fluidité et mémoire après ouverture/fermeture répétée. Ne pas annoncer de gains sans mesure.

## 6. Moteur audio et enregistrement

- Utiliser une horloge audio commune pour synchroniser les pistes. Les timers JavaScript et l’animation de l’interface ne doivent pas servir d’horloge musicale.
- Définir explicitement les unités : secondes, beats, mesures, BPM, hertz et décibels. Centraliser leurs conversions.
- Distinguer les données sérialisables du projet des objets d’exécution : nœuds audio, buffers, flux micro et références DOM.
- Démarrer ou reprendre le contexte audio après une interaction utilisateur ; traiter les permissions micro refusées et les périphériques indisponibles.
- Demander le micro uniquement lors d’une action qui en a besoin et arrêter ses pistes lorsque la session d’enregistrement se termine.
- Éviter le retour micro audible par défaut pour limiter le larsen. Prévenir l’écrêtage et les sauts brutaux de gain.
- Libérer les ObjectURL, déconnecter les nœuds, arrêter les sources et relâcher les buffers inutilisés. Réutiliser le contexte audio lorsque cela convient au cycle de vie du studio.
- Conserver les prises originales. Appliquer les effets et corrections de manière non destructive autant que possible.
- Vérifier les formats réellement supportés avant d’enregistrer ou d’exporter ; afficher les limites du navigateur.
- Faire correspondre autant que possible le rendu exporté au mix écouté. Tester aussi la durée, les niveaux et la position des clips.

## 7. Backend, données et sécurité

- Valider côté serveur chaque entrée : identifiant, texte, valeur numérique, fichier, requête HTTP et événement temps réel. Le frontend et les guards ne constituent pas une protection serveur.
- Authentifier l’utilisateur et vérifier ses droits sur chaque projet, piste, fichier et publication ; ne pas faire confiance à un `ownerId` envoyé par le client.
- Définir des permissions explicites : propriétaire, collaborateur autorisé et lecteur selon les besoins. Vérifier également les invitations et leur révocation.
- Utiliser une liste explicite des champs modifiables ; ne pas transmettre directement un objet client à une requête MongoDB.
- Limiter les tailles de requêtes, uploads et messages temps réel. Contrôler les types de fichiers et générer des noms de stockage indépendants des noms utilisateur.
- Stocker les octets audio séparément des documents du projet, avec des références contrôlées. Prévoir le nettoyage des fichiers orphelins.
- Versionner le format de sauvegarde et traiter les projets incompatibles avec un message explicite ; ne pas écraser des données devenues illisibles.
- Ne jamais committer ni journaliser `.env`, mots de passe, tokens, clés, URI privées, prises vocales ou autres contenus privés.
- Hacher les mots de passe ; utiliser HTTPS en déploiement, une configuration CORS ciblée et des limites sur les opérations sensibles.
- Retourner des erreurs utiles sans stack ni secret. Garder des logs sobres avec le contexte nécessaire au diagnostic.
- Mettre à jour `API_CONTRACT.md` avec toute évolution : méthode, URL, authentification, paramètres, corps, réponses et erreurs. Documenter aussi les événements collaboratifs.

## 8. Collaboration et protection du travail

- Le serveur vérifie les permissions de chaque opération et de chaque abonnement à un projet, y compris après une révocation d’accès.
- Définir une stratégie explicite pour les modifications concurrentes : révision du projet, verrou ciblé ou fusion selon la complexité réelle. Ne pas écraser silencieusement le travail d’un autre utilisateur.
- Donner des identifiants stables aux pistes, clips et opérations. Prévenir les doublons lorsqu’une opération est retransmise après reconnexion.
- Distinguer présence, modification locale, modification confirmée et sauvegarde durable.
- Traiter la perte de connexion : état visible, nouvelles tentatives bornées et resynchronisation. Ne pas afficher « sauvegardé » avant confirmation.
- Préserver les modifications non sauvegardées et prévoir une récupération simple en cas d’échec. Ne pas ajouter un fonctionnement hors ligne complet sans besoin validé.
- Ne pas diffuser continuellement les buffers audio via le canal des petites modifications : transférer les fichiers séparément et partager leurs références autorisées.

## 9. Publication et droits sur les contenus

- Garder les projets et enregistrements privés par défaut. Publier doit être une action explicite et distincte de sauvegarder.
- Distinguer le projet éditable du morceau final publié. Définir qui peut publier, modifier ou retirer une publication.
- Ne pas rendre les prises originales ou fichiers privés accessibles via une simple URL publique de stockage.
- Utiliser des samples et instruments dont la licence permet l’utilisation prévue ; conserver les sources et attributions nécessaires.
- Permettre au propriétaire de retirer son contenu publié et expliquer l’effet sur les liens partagés.

## 10. Tests et vérifications

- Pour chaque nouvelle fonctionnalité métier, ajouter des tests unitaires utiles : comportement attendu, limites et erreurs pertinentes.
- Ne pas tester uniquement les détails internes de l’implémentation ; vérifier les résultats observables et les contrats.
- Tester particulièrement les conversions temporelles, placements de clips, règles de permissions, sauvegardes, conflits, reconnexions et erreurs d’upload.
- Isoler HTTP, le micro et le moteur audio dans les tests unitaires. Conserver des vérifications manuelles audio : un mock réussi ne prouve pas la qualité sonore ni la synchronisation.
- Ajouter des tests d’intégration ciblés pour les interactions critiques entre API, droits et données ; ne jamais utiliser la base de production pour les tests.
- Exécuter `npm test` dans chaque partie modifiée et `npm run build` dans `frontend-starter/` après un changement frontend.
- Vérifier les parcours concernés au navigateur, les tailles d’écran pertinentes, la console et le panneau Network ; ne pas exposer les tokens dans les captures.
- Pour une modification documentaire seule, relire les liens et la cohérence ; aucun build n’est nécessaire.
- Rapporter les commandes réellement exécutées et leurs résultats. Distinguer tests réussis, vérifications manuelles et contrôles non réalisés.

## 11. Git, documentation et travail étudiant

- Faire des changements limités à une mission, avec des commits explicites. Préserver les modifications des autres membres.
- Ne pas committer `node_modules`, les builds, caches, secrets, exports audio et fichiers temporaires. Versionner les lockfiles.
- Maintenir le README pour l’installation, la configuration, le lancement et les tests. Utiliser `.env.example` avec des valeurs factices.
- Tenir le suivi des missions à jour sans cocher une fonctionnalité non vérifiée.
- Maintenir `REPORT.md` pour les choix techniques, fonctionnalités réalisées, résultats des tests, limites et répartition du travail ; conserver un usage cohérent du rapport IA si celui-ci est demandé.
- Chaque membre doit pouvoir expliquer le code retenu, les dépendances et les tests. Un code généré doit être relu et compris avant intégration.
- Ne pas ajouter de TODO vague : décrire le problème restant et son impact, ou créer une mission identifiable.

## 12. Critère de fin d’une mission

Une mission est terminée lorsque le comportement demandé fonctionne, que les erreurs prévisibles sont traitées, que les droits et ressources sont gérés, que l’interface reste utilisable aux tailles concernées, que les vérifications pertinentes ont été exécutées et que la documentation décrit le résultat réel. Signaler clairement toute limite restante.
