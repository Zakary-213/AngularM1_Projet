# Gemini instructions

Follow `AGENTS.md` and `best-practices.md`. Keep one class per TypeScript file, colocate each component's `.ts`, `.html`, and `.css`, use `inject()` and Signals, preserve the documented API routes, and never put credentials or JWT secrets in Angular code. If a route changes intentionally, update the « Contrat d'API » section of `../README.md` in the same change with method, URL, auth, parameters, body, responses, and errors.
