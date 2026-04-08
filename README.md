# paper-reader-ts

Local-first paper reading workspace built with Next.js, Prisma, and a staged multi-agent workflow.

## Getting started

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Generate the Prisma client with `npm run prisma:generate`.
4. Start the app with `npm run dev`.

## Current scope

- Root-level application scaffold under `src/`
- Prisma schema under `prisma/schema.prisma`
- App Router pages for list, search, paper detail, and settings
- Project-local storage layout under `storage/`
