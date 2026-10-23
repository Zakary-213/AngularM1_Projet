# Claude instructions

Avant toute modification, lire intégralement `../AGENTS.md`, puis le `AGENTS.md` de ce dossier. Le guide racine est obligatoire et commun à tous les agents.

Follow `AGENTS.md` and `best-practices.md`. This project uses Angular 22 standalone components, `inject()`, Signals, Reactive Forms, and native `@if`/`@for` control flow. Preserve `API_CONTRACT.md`, keep shared infrastructure in `src/app/shared`, and follow `../backend/AGENTS.md` when an authorized project feature also requires backend changes. If an API route must intentionally change, update `API_CONTRACT.md` in the same change with its method, URL, auth, parameters, body, responses, and errors.
