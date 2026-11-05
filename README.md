# GoHighLevel to MerusCase intake demo

A static, click-through simulation of a one-way intake integration. A GoHighLevel
lead at stage Signed becomes a MerusCase case.

## What the demo shows

- Contact dedupe by name, then phone, email or date of birth.
- A 29-field map, with 15 representative fields on screen.
- Firm ID lookup for status, venue, office, attorney and staff.
- One `caseFiles/add` POST per injury.
- Proposals for referral source, signed date and employer.
- A resend check that stops duplicate cases.

All data is fake. The page has no backend, no API keys and no network calls.
Endpoint names come from the job posting. Payload shapes are illustrative.

## Run it

```sh
npm install
npm test
npm run build
npm run preview
```

The build writes static files to `dist/`.

## Deploy

Cloudflare Pages: build command `npm run build`, output directory `dist`.

## Structure

- `src/engine.ts`: pure integration engine.
- `src/fixtures/`: fake GoHighLevel leads and MerusCase records.
- `src/main.ts`: page logic.
- `src/engine.test.ts`: scenario tests.
