# Provvy frontend commercial-readiness audit

**Audience:** Chief UX & Product Design Officer
**Date:** 16 November 2026
**Scope:** Read-only UX and frontend audit. No application code, backend, schema, payment, or auth behavior was changed.
**Product named in this request:** an AI-native commercial operating system for businesses, agencies, and creators (relationships, agreements, obligations, workflows, revenue sharing, payments).
**Product named in the repository:** “Provvypay — Payment Links”, metadata description “Payment Links MVP” (`apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`).

This audit reports only what was read in source or measured in a local run. Statements that go one step past a direct observation are marked **inferred**.

---

## 1. Executive summary

Provvy is not commercially launchable as a commercial operating system, and it is not launchable as the payment-links product the interface claims to be.

The web app is a Next.js App Router shell with five user-facing routes: a landing page, Clerk sign-in, Clerk sign-up, a one-paragraph dashboard, and a merchant-settings form. There is no screen for agreements, participants, relationships, workflows, obligations, revenue share, payouts, payment links, notifications, or a financial dashboard. There is no component library, no status system, and no application navigation.

A local `next dev` run (no production credentials) showed four launch blockers in the UI that does exist:

1. **Account creation fails.** Submitting sign-up returns Clerk’s own error: “This app uses an outdated version of Clerk, so signing up isn’t available right now.” The installed package is `@clerk/nextjs` 6.34.5. The signed-in dashboard and settings form could not be opened.
2. **The auth UI customers would see is a development instance named “My Application.”** Sign-in and sign-up render an orange “Development mode” line. This run had no Clerk keys in the repo; Clerk keyless mode minted a `pk_test` instance. Production keys are not in source, so a live Clerk app could be branded differently. Nothing in the React code sets a product name, appearance, or legal copy.
3. **The only financial form misstates money.** One control labeled “Default / functional currency” writes both `defaultCurrency` and `functionalCurrency`. The form never loads the saved record. The browser calls `POST /orgs/:clerkOrgId/settings` with no session token, and the Nest controller that receives it has no auth guard.
4. **Logo upload is not tied to the caller’s organization.** `POST /api/uploads/presign` accepts any `orgId` in the JSON body. Middleware only checks that some user is signed in.

Dark mode and contrast were measured against the compiled stylesheet. Landing text passes. Dashboard and settings secondary copy uses `text-neutral-600`, which is **2.53:1** on the dark page background (`#0a0a0a`). The success sentence uses `text-green-600`, which is **3.22:1** on white. Both fail WCAG 2.2 AA body text (4.5:1).

---

## 2. How this was verified

| Check | Result |
| --- | --- |
| Source read | Every file under `apps/web`, plus the Nest merchant-settings module, `apps/api/prisma/schema.prisma`, and the SQL migrations, so the UI could be compared with the data it depends on. |
| Install | `pnpm install --frozen-lockfile` at the repo root. No `.env` files are present. |
| Run | `pnpm dev` in `apps/web` on `http://127.0.0.1:3000`. The API was not started. No production database or production Clerk keys were used. |
| What rendered | Landing, in-app sign-in, in-app sign-up, sign-up after submit, default 404, and (in one session) the hosted Clerk account portal reached from `/dashboard` and `/settings`. Desktop 1440 and mobile 390. Dark landing was rendered from the server HTML plus the compiled CSS with `prefers-color-scheme: dark`. |
| What did not render | Signed-in `/dashboard` and `/settings`. Sign-up is rejected by Clerk before a session exists. A second navigation inside the same headless Chrome session often hung on this dev server, so some viewports were captured as a fresh browser or from the server document. |
| Contrast | Chrome `getComputedStyle` on the compiled utilities, converted through canvas. Ratios below are measured, not estimated from hex. |
| Dev chrome | `next dev` draws a “Rendering…” badge. Clerk keyless draws a “Configure your application” card. Both are absent from product source. On the 390px sign-up screenshot that card covers the Continue button. They are not scored as production defects. They did block completing mobile sign-up in this environment. |

Screenshots from this run (not committed; local artifacts only):

- `home-desktop-light.png` — live landing, including dev chrome
- `home-desktop-light-markup.png`, `home-mobile-light.png`, `home-desktop-dark.png`, `home-mobile-dark.png` — server HTML + compiled CSS, scripts removed
- `sign-in-desktop-light.png`, `sign-in-mobile-light.png`
- `sign-up-desktop-light.png`, `sign-up-mobile-light.png`, `sign-up-after-submit-desktop.png`
- `dashboard-unauth-desktop-light.png`, `dashboard-unauth-mobile-light.png` — hosted account portal
- `missing-agreements-desktop-light.png`, `missing-agreements-mobile-light.png`, `missing-agreements-desktop-dark.png` — default 404

---

## 3. Frontend map

### Stack

| Layer | What is in the repo |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo (`package.json`, `pnpm-workspace.yaml`, `turbo.json`). npm package name is `provvypay`. There is no `packages/` directory, so there is no shared UI package. |
| Web | Next.js 16.0.1 App Router, React 19.2, TypeScript strict (`apps/web`). Dev server: `next dev`. |
| Auth | `@clerk/nextjs` 6.34.5. `ClerkProvider` in `apps/web/src/app/providers.tsx`. Route gate in `apps/web/src/middleware.ts`. |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` (`apps/web/postcss.config.mjs`). One global file, `apps/web/src/app/globals.css`. |
| Fonts | `next/font` loads Geist and Geist Mono and sets CSS variables on `<body>` (`apps/web/src/app/layout.tsx`). The compiled `body` rule then sets `font-family: Arial, Helvetica, sans-serif`. Computed font on the landing page was Arial. Geist is downloaded and not used for text. |
| API the UI calls | Browser `fetch` to `NEXT_PUBLIC_API_BASE_URL` or `http://localhost:4000`, path `/orgs/${orgId}/settings`. Logo bytes go to S3 through `POST /api/uploads/presign`. |
| API that exists | NestJS. The only domain controller is merchant settings (`apps/api/src/merchant-settings`). CORS allows `http://localhost:3000` and `http://localhost:3001` only (`apps/api/src/main.ts`). |
| Data model the UI can use | Prisma models `Organization` and `MerchantSettings` (`apps/api/prisma/schema.prisma`). |
| Data model the UI cannot use | SQL migrations also create `PaymentLink` and `PaymentEvent`, and a `PaymentStatus` enum `DRAFT`, `OPEN`, `PAID`, `EXPIRED`, `CANCELED` (`apps/api/prisma/migrations/20251112064847_add_payment_links/migration.sql`, `20251113070836_add_payment_intent_id/migration.sql`). Those models are not in `schema.prisma`. No web file references them. **Inferred:** the current Prisma client cannot read or write payment links. |
| Tests | `apps/web/package.json` has `dev`, `build`, `start`, `lint`. It has no test script and no test files. No Playwright, Testing Library, or accessibility suite. CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm test`, and `pnpm build`. Turbo only runs `test` where a package defines it, which is the API’s “Hello World” unit test. The web build in CI expects `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `NEON_DATABASE_URL` GitHub secrets. |
| Conventions | App Router file routes. One client component (`settings-form.tsx`). No `loading.tsx`, `error.tsx`, `not-found.tsx`, route groups, or shared layout for the signed-in app. ESLint is `eslint-config-next` core-web-vitals plus TypeScript. |

### Design tokens and styling

`globals.css` defines `--background` / `--foreground` (`#ffffff` / `#171717`, and `#0a0a0a` / `#ededed` under `prefers-color-scheme: dark`) and maps them to Tailwind `--color-background` and `--color-foreground`. Nothing in `apps/web/src` uses `bg-background` or `text-foreground`. Screens use one-off Tailwind classes (`bg-zinc-50`, `text-neutral-600`, `bg-black`, `text-green-600`, `text-red-600`).

Dark mode is not a theme. Only the landing card uses `dark:` variants. Dashboard, settings, and the auth pages do not. The body color and background still flip with the OS preference, which is why dashboard secondary text becomes gray-on-near-black.

There is no semantic token for success, warning, danger, info, or money. There is no focus-ring token. Tailwind preflight sets `button, input, select, textarea { color: inherit; background-color: transparent }`, so fields pick up the body color. Measured input text was 17.93:1 on white and 16.91:1 on `#0a0a0a`. Typed text is readable in both schemes. The failure is the utilities that hard-code a mid gray or a bright green.

### Reusable components

None. Search of `apps/web/src` found no `aria-*`, `htmlFor`, `role=`, `focus:`, or `sr-only`. There is no Button, Field, Select, Table, Modal, Badge, Toast, EmptyState, or PageHeader. The only button is the settings submit control. The only links with a class are `underline` anchors. Status is a green or red paragraph under that form.

### Navigation

There is no app shell.

- Landing: two text links, Sign in and Create account.
- Dashboard header: Clerk `OrganizationSwitcher`, the string `Org: ${name}` or `No org selected`, Clerk `UserButton`, and a text link “Go to Settings”.
- Settings: a title and a form. No link back. No switcher. No footer.
- Auth pages: a centered Clerk card and nothing else. No product header, no pricing, no terms.

### User types

The UI has one actor: a Clerk user. If that user has an active organization id, settings can be edited. There is no role, no participant, no agency, no creator, and no payer-facing page. **Inferred from the schema as well:** the database the app is written against has the same single-tenant-merchant shape.

---

## 4. Route inventory

| Route | Purpose | Who it serves | Observed state |
| --- | --- | --- | --- |
| `/` | Landing. Signed-in users are redirected to `/dashboard`. | Anonymous visitor | Renders. Title “Provvypay”. H1 “Provvypay — Payment Links”. One sentence: “Sign in to access your dashboard.” |
| `/sign-in/[[...sign-in]]` | Clerk `<SignIn path="/sign-in">`. | Anonymous | Renders on this origin. Heading “Sign in to My Application”. Orange “Development mode”. |
| `/sign-up/[[...sign-up]]` | Clerk `<SignUp path="/sign-up">`. | Anonymous | Renders. Submit is rejected. See P0-1. |
| `/dashboard` | Post-login home. | Signed-in Clerk user | Unauthenticated curl: `307` to `/sign-in`. Signed-in UI not reached. Source is a welcome line plus a settings link. |
| `/settings` | “Merchant Settings” form. | Signed-in user with an active Clerk org | Unauthenticated curl: `307` to `/sign-in`. Without `orgId`, source returns a paragraph and no way forward. With `orgId`, source renders `SettingsForm`. |
| `POST /api/settings` | Mock JSON save. Returns `ok: true` and “Mock save only…”. | Signed-in (middleware) | Not called by the form. |
| `POST /api/uploads/presign` | S3 presigned PUT for a logo. | Signed-in (middleware only) | Called by the form when a file is chosen. |
| Any other path, including `/agreements` | — | — | HTTP 404. Next.js default “404 / This page could not be found.” No link back. |

Protected matchers in `apps/web/src/middleware.ts`: `/dashboard(.*)`, `/settings(.*)`, `/api/(.*)`. The check is “a Clerk user id exists”. It does not check organization membership.

---

## 5. Module audit

Scores are against the criteria in the brief: first impression, discoverability, comprehension, completion, feedback, recovery, consistency, trust, accessibility, responsiveness. “Absent” means there is no route, component, or copy for that job.

| Module | Verdict |
| --- | --- |
| Onboarding / business setup | **Partial and blocked.** The only setup task is display name, one currency control, and an optional logo. It is unreachable until sign-up works, and the no-organization state is a dead end. |
| Participant onboarding | **Absent.** |
| Agreements, create / approve | **Absent.** `/agreements` is the default 404. |
| Relationships | **Absent.** |
| Workflows and obligations | **Absent.** |
| Payment setup | **Absent in the UI.** Copy promises payment links. SQL history has a payment-link table. The running app has neither a screen nor a Prisma model. |
| Payouts | **Absent.** |
| Financial dashboards | **Absent.** Dashboard copy is “Next up: Settings & Payment Links.” No amounts, statuses, or balances. |
| Notifications | **Absent.** No inbox, no toasts. The settings result is a paragraph with no `aria-live`. |
| Empty, error, and success states | **Only the settings form has any.** Empty dashboard is a promise. App-level error and not-found are Next defaults. Sign-up’s failure state is a developer message in a red box. |

### Landing (measured)

- Desktop and 390px: no horizontal overflow (`scrollWidth` equals viewport). At 390px the H1 wraps to two lines inside the card. That is readable, not a break.
- Light: H1 black on white, 21:1. Subtitle `text-zinc-600` on white, **7.72:1**. Links `#171717` on white, 17.93:1.
- Dark: H1 `dark:text-zinc-50` on black. Subtitle `dark:text-zinc-400` on the dark page, **7.55:1**. Links `#ededed` on black, 17.94:1.
- Primary actions are underlined body text, 16px, **24px tall**, 49px (“Sign in”) and 109px (“Create account”), with a 16px gap. That meets the WCAG 2.2 AA 24px minimum and misses any sense that one action is primary.
- Keyboard: the links are anchors. A dark-mode focus probe showed a visible light outline on a focused link. There is no skip link. **Not a failure on the evidence collected.**
- The page does not say who the product is for, what a payment link is, what it costs, or what happens after sign-in.

### Auth (measured)

- Sign-up fields exposed by Clerk include `firstName-field`, `lastName-field`, `emailAddress-field`, and `password-field`. First and last name are marked optional. Google is offered.
- Sign-in heading is “Sign in to My Application”. The card shows Google, email, and Continue. Footer text includes “Secured by Clerk” and “Development mode”.
- At 390px the sign-in Continue button was on screen (top 291px, height 30px) in the viewport used. The keyless dev card covered the lower “Development mode” line. On sign-up at 390px the same dev card covered Continue. Treat the overlay as environment, and treat the underlying card as a single column that otherwise fits 390px.
- Submitting a valid password showed the green line “Your password meets all the necessary requirements.” The page’s text content contained that sentence twice (**inferred:** a visual line plus an accessible duplicate). Continue then stayed unavailable because of the SDK error in P0-1.
- No terms, privacy, or product explanation is passed into `<SignIn>` or `<SignUp>`.

### Dashboard (source; signed-in screen not opened)

`apps/web/src/app/dashboard/page.tsx` renders a welcome using `firstName`, the sentence “This is your dashboard. Next up: Settings & Payment Links.”, and one link. The header does not wrap (`flex` without `flex-wrap`). **Inferred, not screenshotted:** Clerk’s organization switcher plus the org label plus the user button is a likely overflow at 390px. Do not treat that as confirmed.

### Settings (source; form not opened while signed in)

See P0-3, P0-5, and the P1 settings findings. The form’s structure, request, and copy were read in full. The save request was not executed, because a session could not be created and the API was intentionally not started.

### 404 (measured)

`/agreements` returns the default Next.js 404. Light and dark text contrast is black-on-white and white-on-black. The page uses Times New Roman, not the app font. There is no Provvy name and no link to the landing page or sign-in.

---

## 6. Findings

### P0-1. A new business cannot create an account, and the account UI that renders is a development app called “My Application”

**UX FINDING.** On 16 November 2026, submitting `/sign-up` with a completed password showed this error in the Clerk card, in red, with a warning icon:

> This app uses an outdated version of Clerk, so signing up isn’t available right now. If you’re the developer, upgrade your Clerk SDK to the latest version. Reference: W3uPRYr8

Continue was then disabled (gray). Google remained on the card. `@clerk/nextjs` in `apps/web/node_modules` is 6.34.5, matching `apps/web/package.json`.

The same session’s sign-in card is titled “Sign in to My Application” and prints “Development mode” in orange (`sign-in-desktop-light.png`, `sign-in-mobile-light.png`). Sign-up uses the same orange line. The components are:

```1:9:apps/web/src/app/sign-in/[[...sign-in]]/page.tsx
"use client";
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <SignIn routing="path" path="/sign-in" />
    </div>
  );
}
```

`<SignUp>` is the same pattern. No `appearance`, localization, product name, or legal links are set.

**Caveat, so this is not over-read.** The repo contains no Clerk keys. Starting the dev server caused Clerk keyless mode to write a development instance under `apps/web/.clerk` (a `pk_test` publishable key). “My Application” and “Development mode” were observed on that instance. A production Clerk application, configured outside this repo, could use a different name and would not show the development badge. The signup rejection was returned by Clerk’s hosted API to this SDK, in the product’s own sign-up card.

In one earlier browser session, unauthenticated `/dashboard` finished on the hosted account portal `proven-liger-143.accounts.dev` with the same “My Application” title and “Development mode” line. Curl against `/dashboard` returns `307 Location: /sign-in`. Both the embedded card and the hosted portal were observed. The hosted host exists only because this audit triggered keyless mode. It is not a production domain.

**USER IMPACT.** A prospective customer cannot finish “Create account”. Someone who already has a user on a development instance would sign in under a generic name, on a screen that says the product is in development. The error tells them to upgrade an SDK.

**COMMERCIAL IMPACT.** There is no acquisition path. A payments or contracting product that shows “Development mode” will not be trusted with a business or a payout. This blocks every later module.

**RECOMMENDATION.** Upgrade `@clerk/nextjs` until a new user can complete sign-up against a current Clerk development instance, then repeat the sign-up, sign-in, and org-creation path. Before any external user, use a production Clerk instance (`pk_live`) whose application name is Provvy, and set the embedded component’s appearance so the card does not depend on the dashboard default. Remove the developer-facing sentence from the end-user error; if Clerk still returns it, do not ship that SDK. Add the product name, what the account is for, and links to terms and privacy around the card.

**IMPLEMENTATION.** `apps/web/package.json`, `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`, `apps/web/src/app/providers.tsx`, `apps/web/src/middleware.ts`. Confirm the Clerk dashboard application name and instance type outside the repo.

**PRIORITY.** P0.

**VERIFICATION.** Create a user with email and with Google. Land on `/dashboard` without an SDK error and without “Development mode”. Sign out and sign in. Confirm the visible product name is Provvy on both 1440 and 390. Confirm a production deployment does not use `pk_test`.

**DEPENDENCIES / RISK.** Frontend dependency upgrade. Git history already contains several Clerk v6 middleware fixes (`auth().protect()` replaced by a manual `userId` check). Retest the unauthenticated redirect for `/dashboard`, `/settings`, and `/api/*` after the upgrade. No database change. Do not print or commit the keyless keys this audit generated under `apps/web/.clerk`.

**BACKEND.** Not required for the SDK upgrade. Production instance setup is Clerk configuration, not the Nest API.

---

### P0-2. The commercial operating system is not in the interface, and neither are payment links

**UX FINDING.** User-facing routes are only `/`, `/sign-in`, `/sign-up`, `/dashboard`, and `/settings` (section 4). There is no UI for participant onboarding, agreements, approval, relationships, workflows, obligations, revenue share, payouts, notifications, or a financial dashboard.

The words “Payment Links” appear as the landing H1 and in the dashboard sentence “Next up: Settings & Payment Links.” There is no payment-link list, create form, status, copy-link action, or payer page. `PaymentStatus` values `DRAFT`, `OPEN`, `PAID`, `EXPIRED`, and `CANCELED` exist only in a SQL migration. `schema.prisma` ends at `MerchantSettings`.

**USER IMPACT.** After account creation, a business, agency, or creator has nowhere to do the job they came for. A payer has no page. An empty dashboard that names a feature the product does not have teaches the customer not to trust the next label.

**COMMERCIAL IMPACT.** None of the revenue, contracting, or payout journeys can be started, completed, or supported. Launching this UI as a commercial OS would be a false product. Launching it as payment links would be the same, one sentence later.

**RECOMMENDATION.** Do not add a shell of empty modules to look complete. Pick the first commercial job that can be finished in one sitting and build that loop before anything else. If that job is payment links, the minimum loop is: create a link (amount in minor units, currency, description, expiry), see its status in the words of the enum, copy or share it, and open a payer page that states amount, currency, merchant name, and what “paid”, “expired”, and “canceled” mean. If that job is merchant setup only, delete the payment-link promise until the loop exists. Agreements, revenue share, and payouts need their own information architecture; they should not be implied by the dashboard.

**IMPLEMENTATION.** New routes under `apps/web/src/app`. The dashboard sentence is `apps/web/src/app/dashboard/page.tsx` lines 39–41. The landing H1 is `apps/web/src/app/page.tsx` lines 14–16. Payment-link persistence is not available through the current Prisma schema, so a real payment-link UI cannot be wired to the current API client.

**PRIORITY.** P0.

**VERIFICATION.** A new merchant can name the task, finish it, and see a truthful status without hitting a 404. A second user type, if the product has one, has a screen that names them. Copy on the landing page and dashboard matches the screens that exist.

**DEPENDENCIES / RISK.** Building the missing modules is new product surface, not a patch. Shipping placeholder pages would make P0-2 look fixed and leave completion broken. Payment status must not be communicated by color alone once it exists.

**BACKEND.** Required before any of these modules can persist or move money. The Nest app currently exposes merchant settings only. This audit did not design that API.

---

### P0-3. Merchant settings are saved with no session, and the browser tells the API who the user is

**UX FINDING.** `SettingsForm` posts JSON directly to the API:

```79:92:apps/web/src/app/settings/settings-form.tsx
      const apiRes = await fetch(
        `${API_BASE_URL}/orgs/${orgId}/settings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            logoKey,
            defaultCurrency: currency,
            functionalCurrency: currency,
            updatedByUserId: clerkUserId,
          }),
        }
      );
```

`API_BASE_URL` is `process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"`. The request sets no `Authorization` header and no credentials mode. `updatedByUserId` is whatever the client puts in the body. The server component passes the Clerk user id into the client component as a prop, so it is visible to the page and editable in devtools.

The handler that receives this body is `MerchantSettingsController` in `apps/api/src/merchant-settings/merchant-settings.controller.ts`. `GET` and `POST` `:clerkOrgId/settings` have no auth guard. `upsertByClerkOrgId` creates the organization if the id is new and overwrites display name, logo, and both currencies.

The failure path shows the raw response to the merchant:

```94:106:apps/web/src/app/settings/settings-form.tsx
      if (!apiRes.ok) {
        const text = await apiRes.text();
        throw new Error(`Settings API failed: ${apiRes.status} ${text}`);
      }
      // ...
      setError(message);
```

That string is rendered in `text-red-600`. This save was not executed in the browser (no session, API not started). The wiring above is the source.

Separately, the API’s CORS allow-list is only `localhost:3000` and `localhost:3001` (`apps/api/src/main.ts`). **Inferred:** a deployed web origin cannot call this API from the browser until that list changes, even after the env var is set. If the env var is missing, the browser calls the user’s own machine.

**USER IMPACT.** The person editing the form cannot tell whether the name and currency customers will see were saved by them, overwritten by someone else, or never saved. When the call fails, they may see a status code and a server body instead of a next step.

**COMMERCIAL IMPACT.** Display name and currency are what a payer would use to recognize a charge. An unauthenticated write is a merchant-impersonation and ledger-setup bug. It is a launch blocker for any real payment, even though payments are not on screen yet.

**RECOMMENDATION.** The browser should call a same-origin route that takes the Clerk session, checks the active organization, and forwards the save. The Nest route must reject unauthenticated calls and must ignore any user id in the body. Map failures to a sentence a merchant can act on (“We couldn’t save your business settings. Nothing was changed.”) and keep the raw body in logs. Set `NEXT_PUBLIC_API_BASE_URL` only if the browser must call the API directly, and then send a real session. Load the existing record on open (the GET already exists) so a refresh does not look like a blank business.

**IMPLEMENTATION.** `apps/web/src/app/settings/settings-form.tsx` (request, error copy, initial load). A new authenticated route next to `apps/web/src/app/api/uploads/presign/route.ts` is the natural place to attach the session. `apps/api/src/merchant-settings/merchant-settings.controller.ts` and `merchant-settings.service.ts` need a real guard. `apps/api/src/main.ts` CORS. `apps/web/src/app/api/settings/route.ts` is a mock that returns success and must not be wired up as a shortcut.

**PRIORITY.** P0.

**VERIFICATION.** Signed out, `POST /orgs/{id}/settings` is rejected. Signed in as org A, a save for org B is rejected. The stored `updatedByUserId` matches the session, not the body. A failed save shows no stack, SQL, or status dump. Reload shows the saved name and currency. A non-localhost origin can save only when it is explicitly allowed.

**DEPENDENCIES / RISK.** Needs backend auth work. Tightening CORS will break any local web port other than 3000 and 3001 until those origins are added on purpose. Do not “fix” this by calling the mock `/api/settings` route; it reports success without storing anything.

**BACKEND.** Yes. The UI change is not sufficient while the Nest route trusts the body.

---

### P0-4. Any signed-in user can request a logo upload URL for any organization id

**UX FINDING.** Choosing a logo posts `{ orgId, contentType }` to `/api/uploads/presign` (`settings-form.tsx` lines 48–55). The route checks that `orgId` and `contentType` are non-empty strings, picks `png`, `jpg`, or `bin`, and returns a presigned S3 PUT plus the object key (`apps/web/src/app/api/uploads/presign/route.ts`). It never calls `auth()`, never compares `orgId` with the session’s organization, and does not restrict size. Middleware only requires some signed-in user (`apps/web/src/middleware.ts`).

The client `accept` attribute limits the file picker to png and jpeg. The route does not. A content type that is neither becomes `uploads/${orgId}/{uuid}.bin` and still gets a URL. The button error for a failed presign says “Failed to get upload URL from backend”, which names the wrong system.

**USER IMPACT.** A merchant’s logo is the mark a payer uses to recognize them. Another signed-in account that knows or guesses an organization id can write an object under that prefix. The merchant is not told that the upload is unrestricted, and a failure sounds like a generic backend outage.

**COMMERCIAL IMPACT.** Cross-tenant write on the only brand asset the product stores. Combined with P0-3, the displayed business identity is not under the merchant’s control.

**RECOMMENDATION.** In the presign route, require a session and set the key from `auth().orgId`, ignoring the body organization id. Allow only `image/png` and `image/jpeg`, reject missing or oversized files with a limit stated next to the file input (“PNG or JPEG, up to N MB”). Say “We couldn’t prepare the logo upload” rather than “backend”.

**IMPLEMENTATION.** `apps/web/src/app/api/uploads/presign/route.ts`, `apps/web/src/app/settings/settings-form.tsx` (file copy and error string), `apps/web/src/middleware.ts` (the matcher is not an org check).

**PRIORITY.** P0.

**VERIFICATION.** Signed out, the route does not return a URL (JSON 401, not an HTML redirect that `fetch` might treat as success). Signed in as org A, a body with org B does not produce a key under B. A `text/html` content type is rejected. The file input’s helper text matches the rule.

**DEPENDENCIES / RISK.** Frontend route change. If the S3 bucket policy is the real isolation boundary, confirm that separately; this audit did not read bucket policy. Presigned URLs already expire in 300 seconds, which does not fix the tenant mix-up.

**BACKEND.** The Next route can enforce the session org without a Nest change. The settings record that stores `logoKey` still needs the auth in P0-3, or a caller can point the merchant at an object they should not control.

---

### P0-5. One unlabeled-in-practice currency control writes two different financial fields

**UX FINDING.** The form has a single `<select>` labeled “Default / functional currency” with AUD, USD, and EUR. On submit it sends that same code as both `defaultCurrency` and `functionalCurrency` (`settings-form.tsx` lines 84–88 and 128–142). The Prisma model stores those as two separate `VarChar(3)` columns (`schema.prisma` lines 31–33). The label does not say they will be saved as the same code, and it does not say what either term means for prices, settlement, or reporting.

The control is not associated with the label: the `<label>` has no `htmlFor`, and it does not wrap the `<select>`. The same is true of the business-name and logo fields. There is no help text.

The form always starts from `useState("")` and `useState("AUD")`. It never calls `GET /orgs/:id/settings`. **Inferred:** a merchant who saved USD and returns later sees AUD selected, and a save without a change would persist AUD over USD. That reload was not executed; the initial state and the missing GET are in the source.

**USER IMPACT.** A business that prices in one currency and keeps books in another cannot say so. A business that can live with one currency is not told that this choice is the one customers and reports will inherit. Reloading the page looks like the choice was lost.

**COMMERCIAL IMPACT.** This is the only money decision in the product. Writing it twice, silently, will be wrong the moment a payment link, invoice, or payout reads either column. Fixing the data later means telling merchants their currency was assumed.

**RECOMMENDATION.** Until the product truly has two currencies, use one field, label it in merchant language (“Currency for your payment links”), and write that code to both columns only with the helper sentence “Prices and reports will use this currency.” When two currencies are real, show two fields and one sentence each: customer-facing price versus bookkeeping. Load the saved value before showing the form. Associate every label with its control.

**IMPLEMENTATION.** `apps/web/src/app/settings/settings-form.tsx`. The GET is `MerchantSettingsController.getSettings`. No schema change is required to stop collapsing the two fields; the columns already exist.

**PRIORITY.** P0.

**VERIFICATION.** A merchant who needs AUD prices and USD books can save both, reload, and see both. A merchant who has one currency reads a sentence that matches what was stored. Screen reader: each control’s accessible name is the visible label. Changing nothing and saving does not overwrite a previously saved currency with the AUD default.

**DEPENDENCIES / RISK.** If any unreleased client already assumes the two columns match, splitting the UI will surface that. Nothing in this web app reads the columns back today.

**BACKEND.** Not required to relabel and load. Worth adding server-side checks that the codes are supported ISO currencies, so a modified client cannot store an arbitrary string. The UI list is the only restriction today.

---

### P1-1. The signed-in home is a placeholder that names a feature which has no screen

**UX FINDING.** After login the product says “Welcome, {firstName}!” and “This is your dashboard. Next up: Settings & Payment Links.” The only action is “Go to Settings” (`dashboard/page.tsx` lines 35–48). There is no setup progress, no empty state for “you have no payment links”, and no status of whether settings were saved. The header can show “No org selected” with no explanation of what an organization is or why it matters.

**USER IMPACT.** The first signed-in minute does not start a commercial task. “Next up” reads as a promise the product then breaks.

**COMMERCIAL IMPACT.** Activation stops at a greeting. Support will be asked where payment links are.

**RECOMMENDATION.** Replace the sentence with the one action that exists, in the merchant’s language, and a completion state. Example shape, not final copy: if settings are missing, “Add the business name and currency customers will see.” If settings exist, show the business name and currency and stop mentioning payment links until P0-2’s loop exists. If there is no organization, the header should say what to do (see P1-2), not only “No org selected”.

**IMPLEMENTATION.** `apps/web/src/app/dashboard/page.tsx`. Reading settings uses the existing GET. That GET must be authenticated first (P0-3), or the dashboard should read settings through a same-origin session route.

**PRIORITY.** P1.

**VERIFICATION.** A new org sees one next step that can be finished. An org with settings does not see “Next up: Payment Links”. Copy search of the web app finds “payment link” only on screens that create or show one.

**DEPENDENCIES / RISK.** Depends on being able to sign in (P0-1) and to trust the settings read (P0-3).

**BACKEND.** A safe read path, as in P0-3. No new domain.

---

### P1-2. Settings without an organization is a dead end, and the signed-in product has no navigation

**UX FINDING.** If the user is signed in and `orgId` is missing, `/settings` renders:

```13:22:apps/web/src/app/settings/page.tsx
  if (!orgId) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Merchant Settings</h1>
        <p className="mt-2 text-neutral-600">
          Please select an organization in the header before configuring settings.
        </p>
      </main>
    );
  }
```

This page has no header. `OrganizationSwitcher` is only mounted on the dashboard. There is no link back to the dashboard, no control to create an organization, and no definition of “organization”. The instruction cannot be followed on the page that gives it.

The dashboard and settings do not share a layout. From settings, the only exit in the UI is the browser back button, and only if the user arrived from somewhere.

**USER IMPACT.** The merchant who opens Settings before joining or creating an organization is stuck, and the stuck page tells them to use a control that is not there.

**COMMERCIAL IMPACT.** Business setup, the only real task, fails for every account that does not already have an active Clerk organization. That is a normal state for a new sign-up.

**RECOMMENDATION.** Put one signed-in frame on both pages: product name, where you are, organization, account, and Settings. When there is no organization, say so in that frame and offer the Clerk create-organization action on the page that needs it. Do not refer to “the header” unless the header is on the page. Use “business” or “workspace” if “organization” is Clerk’s word rather than the merchant’s.

**IMPLEMENTATION.** A shared layout, for example `apps/web/src/app/(app)/layout.tsx`, used by `dashboard/page.tsx` and `settings/page.tsx`. The dead-end copy is `settings/page.tsx` lines 13–22. `OrganizationSwitcher` is currently inline in `dashboard/page.tsx` lines 25–32.

**PRIORITY.** P1.

**VERIFICATION.** From a user with no organization, open `/settings` directly. Create or choose a business without using the browser back button. Move Dashboard → Settings → Dashboard with a visible control at 1440 and 390. Focus order reaches the nav before the form.

**DEPENDENCIES / RISK.** Clerk’s organization UI is doing the work today. After a Clerk upgrade (P0-1), confirm organizations are enabled for the instance; otherwise the switcher still cannot create one. This was not verified, because sign-up never completed.

**BACKEND.** No.

---

### P1-3. The settings form does not load, confirm, or recover

**UX FINDING.** Beyond P0-5’s currency bug, the form has no initial load, so the fields are empty or AUD every visit. Success is the sentence “Settings saved successfully!” with no statement of what was saved and no next step. Failure is the thrown `Error.message`, which may be the raw API body (P0-3) or a browser message such as a failed `fetch`. There is no `role="status"` or `aria-live`, so a screen reader is not told that the save finished. The button label switches to “Saving...” and `disabled` is set; that part is visible text, which is good. There is no field-level error, no retry that preserves the file the user picked, and no distinction between “upload failed” and “settings failed” except the thrown string.

The logo preview uses `URL.createObjectURL` and never revokes it. That is a minor leak, not the commercial issue. The preview `alt` is “Logo preview”, which is fine.

There is no `loading.tsx` or `error.tsx` anywhere under `apps/web/src/app`. A thrown server render becomes Next’s default error, which was not separately screenshotted.

**USER IMPACT.** The merchant cannot tell whether the business customers will see matches the form. A failure does not say what to do next. Assistive tech may hear nothing when the save completes.

**COMMERCIAL IMPACT.** Setup looks finished when the green line appears, including if a future caller hits the mock `/api/settings` route that returns `ok: true` without storing data. That route is not used today. It is a trap if someone connects the form to it.

**RECOMMENDATION.** Load settings before first paint or behind an explicit loading state. On success, repeat the saved name and currency and move to the next real task. On failure, keep the typed values, say whether the logo or the record failed, and offer retry. Announce both outcomes with `aria-live="polite"`. Delete or clearly isolate the mock route so it cannot be mistaken for a save.

**IMPLEMENTATION.** `apps/web/src/app/settings/settings-form.tsx`, `apps/web/src/app/settings/page.tsx`, `apps/web/src/app/api/settings/route.ts`. Optional `loading.tsx` / `error.tsx` beside those pages.

**PRIORITY.** P1.

**VERIFICATION.** Save, reload, see the same name and currency. Disconnect the API, save, see a human sentence and the typed name still in the field. VoiceOver or NVDA hears the success sentence without moving focus manually. The mock route is gone or returns 410.

**DEPENDENCIES / RISK.** Loading settings depends on an authenticated GET (P0-3). A loading gate must not flash the AUD default before the real value arrives, or P0-5 gets worse.

**BACKEND.** The GET already exists. It needs the same auth as the POST.

---

### P1-4. The only form fails label and success-contrast checks

**UX FINDING.** Business name, currency, and logo labels are not programmatically associated with their controls (`settings-form.tsx` lines 114–160). Placeholder text is “e.g. Provvypay Cafe”. Measured placeholder contrast on white is **3.41:1**, which is below 4.5:1. The visible label is the thing that should carry the name; it currently does not, because it is not tied to the input.

Success copy uses `text-green-600` (`lab(59.0978% -58.6621 41.2579)` in the compiled CSS). Measured contrast on white is **3.22:1**. The class is also `text-sm` (14px), so the large-text exception does not apply. Error copy uses `text-red-600`: **4.77:1** on white (passes) and **4.15:1** on the dark body `#0a0a0a` (fails). The words are present, so status is not color-only. The success color is still not readable enough.

The submit button is 36px tall in the compiled `px-4 py-2 text-sm` classes (measured on a probe element using those classes). White on black was not a contrast failure; a probe that walked past a pure black background mis-reported it, and the source classes are `bg-black text-white`.

**USER IMPACT.** A screen-reader user hears three unlabeled or poorly named fields on the only setup form. A low-vision user can miss “Settings saved successfully!” against the white page.

**COMMERCIAL IMPACT.** The setup form is the merchant’s record of their public name and currency. Failing WCAG 2.2 AA on it is a launch compliance issue, and it makes the success state easy to miss.

**RECOMMENDATION.** Wrap each control with its label or set `htmlFor` and `id`. Keep the placeholder as an example, not as the name. Change the success color to a token that clears 4.5:1 on white and on `#0a0a0a` at 14px, and keep the sentence. Recheck the error red on the dark background the same way.

**IMPLEMENTATION.** `apps/web/src/app/settings/settings-form.tsx`. Color belongs in a semantic token (section 9), not another one-off `text-green-600`.

**PRIORITY.** P1.

**VERIFICATION.** Accessibility tree: each input’s name equals the visible label. Contrast of success and error text is at least 4.5:1 on the actual page background in light and dark, measured in browser devtools, at the rendered font size.

**DEPENDENCIES / RISK.** None beyond the form. Do not remove the text and keep only a green check.

**BACKEND.** No.

---

### P1-5. Dark mode makes the signed-in instructions unreadable

**UX FINDING.** `globals.css` sets the dark body background to `#0a0a0a` and the body text to `#ededed`. Dashboard and settings then paint instructions with `text-neutral-600`, which does not change in dark mode. Measured contrast of that utility on `#0a0a0a` is **2.53:1**. The same utility on white is 7.81:1, so light mode is fine.

Affected copy includes “This is your dashboard. Next up: Settings & Payment Links.”, “No org selected” (`text-sm text-neutral-600`), “Please select an organization in the header…”, and the settings intro if any similar class is added later. Headings inherit the light foreground and stay readable. **The signed-in pages were not opened in a browser;** the ratio is the compiled class on the body background those pages use. The dark landing screenshot confirms the OS dark scheme does apply to this CSS.

Landing subtitle and links were measured separately and pass (section 5). This finding is specifically the pages that do not use `dark:` variants.

**USER IMPACT.** A merchant whose OS is in dark mode can read the heading and can easily miss the only instruction on the page, including the dead-end organization message.

**COMMERCIAL IMPACT.** Setup and the empty dashboard fail for a default OS setting used by a large share of desktop and phone users. It looks broken rather than intentional.

**RECOMMENDATION.** Stop using `text-neutral-600` for body copy on a background that flips with the OS. Either set an explicit light surface for the signed-in app, or pair the muted color with a `dark:` color that clears 4.5:1 on `#0a0a0a`. Do it in one place so the next screen does not repeat the bug.

**IMPLEMENTATION.** `apps/web/src/app/globals.css`, `apps/web/src/app/dashboard/page.tsx` (lines 28 and 39), `apps/web/src/app/settings/page.tsx` (line 18). Prefer a `text-muted` token over editing each class by hand.

**PRIORITY.** P1.

**VERIFICATION.** With `prefers-color-scheme: dark`, dashboard instructions, the no-org sentence, and settings helper text measure at least 4.5:1. Light mode stays at least 4.5:1. Check 1440 and 390.

**DEPENDENCIES / RISK.** A global dark-surface change will also restyle the landing card, which already has its own `dark:` colors. Check both.

**BACKEND.** No.

---

### P1-6. Unknown URLs and in-app failures have no way back

**UX FINDING.** `/agreements` (and, by the same default, any unknown path) renders Next’s built-in 404: “404” and “This page could not be found.” Measured at 1440 and 390, light and dark. The typeface is Times New Roman. There is no Provvy mark and no link. There is no `app/not-found.tsx`. There is no `error.tsx`.

**USER IMPACT.** A mistyped link, a bookmark from a future module, or a shared payment URL that does not exist ends on a generic page. The user has to edit the address bar.

**COMMERCIAL IMPACT.** Every missing module currently fails this way. Even after P0-2, old links and payer typos need a recoverable page. A default 404 on a payments domain looks unfinished and is a poor place to send someone who expected an invoice.

**RECOMMENDATION.** Add `not-found.tsx` inside the root layout with the product name, one sentence, and a link to `/` or `/dashboard` depending on the session. Add an `error.tsx` that says the page failed and offers retry, without a stack trace.

**IMPLEMENTATION.** `apps/web/src/app/not-found.tsx`, `apps/web/src/app/error.tsx`. The current behavior is Next’s default because those files do not exist.

**PRIORITY.** P1.

**VERIFICATION.** `/agreements` shows Provvy and a working link at 1440 and 390, light and dark. Forcing a render error shows the app error boundary, not the framework default, and retry works.

**DEPENDENCIES / RISK.** None.

**BACKEND.** No.

---

### P1-7. The first screen does not say what Provvy is or who it is for

**UX FINDING.** The landing document title is “Provvypay”. The description meta is “Payment Links MVP” (`layout.tsx` lines 9–12). The visible page is the H1 “Provvypay — Payment Links”, the sentence “Sign in to access your dashboard.”, and two underlined links (`page.tsx`). There is no statement of the job, the user (business, agency, creator, payer), the outcome, or what happens after “Create account”. The repo name, the npm package name `provvypay`, and the brief’s name “Provvy” are three different public names. Auth then introduces a fourth: “My Application”.

**USER IMPACT.** A visitor cannot tell whether to sign in, and a payer who lands here has no path that is not “create a merchant account”.

**COMMERCIAL IMPACT.** This is the top of the acquisition funnel. It neither explains a commercial OS nor a payment link. Combined with P0-1, the people who do continue cannot finish.

**RECOMMENDATION.** One name. One sentence that states the job a signed-in business can actually complete today, and nothing they cannot complete. If the only honest job is “save your business name and currency”, the landing page should not lead with “Payment Links”. Give Create account a real button. Keep Sign in secondary.

**IMPLEMENTATION.** `apps/web/src/app/page.tsx`, `apps/web/src/app/layout.tsx` metadata. Naming is a product decision; the code currently commits to “Provvypay” and “Payment Links”.

**PRIORITY.** P1.

**VERIFICATION.** A person who has not seen the repo can say what they will be able to do after creating an account, and that statement matches a screen that exists. The browser tab, H1, and auth card use the same product name.

**DEPENDENCIES / RISK.** Depends on the scope decision in P0-2. Writing commercial-OS marketing onto this landing page would make the trust problem worse.

**BACKEND.** No.

---

### P1-8. Sign-in is two different places

**UX FINDING.** The landing links to `/sign-in`, and the embedded card renders on this origin (measured). Curl to `/dashboard` and `/settings` returns `307` to `/sign-in`. In an earlier browser session in the same run, following `/dashboard` ended on the hosted Clerk account portal (`proven-liger-143.accounts.dev/sign-in?redirect_url=...dashboard`) with a purple Continue button, while the later embedded `/sign-in` card used a near-black Continue button. Both titled the product “My Application” and both showed “Development mode”. The embedded sign-up card says “Create your account”, not “Sign in to My Application”, so sign-in and sign-up do not even share a heading pattern.

**Caveat.** The hosted redirect was observed once, after keyless keys existed, and was not reproduced on every later direct visit to `/sign-in`. Treat “users sometimes leave the origin” as observed, not as the only path.

**USER IMPACT.** The address bar changes to a Clerk host that does not say Provvy. A user who is wary of payment sites is right to hesitate. The back button returns them to a different-looking card.

**COMMERCIAL IMPACT.** Account takeover and phishing training teach people to distrust unexpected domains on money products. An unstable sign-in location undermines the only door into the product.

**RECOMMENDATION.** Keep sign-in and sign-up on the product origin for the entire flow, including organization creation. Point `redirectToSignIn` at the in-app route explicitly. Use the same embedded appearance on both cards.

**IMPLEMENTATION.** `apps/web/src/middleware.ts` (`redirectToSignIn`), `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`. Clerk instance “Account Portal” settings live outside the repo and can still override this. **Inferred** from Clerk’s general behavior, not from a dashboard this audit could open.

**PRIORITY.** P1.

**VERIFICATION.** From a signed-out `/dashboard`, the address bar stays on the product host through email entry, verification, and return. Repeat at 390px. The hosted `accounts.dev` URL does not appear.

**DEPENDENCIES / RISK.** A Clerk upgrade (P0-1) can change the default redirect. Cover it with a test.

**BACKEND.** No.

---

## 7. P2 and P3 (short)

These are real, and they are not the launch blockers above.

**P2.** Landing actions are 24px-tall underlined text, not buttons (`page.tsx`). They meet the 24px AA minimum and do not look like the way in.

**P2.** Geist is loaded and Arial is what the body uses (`globals.css` body rule; computed style on the landing page). One font decision, applied.

**P2.** Settings file input has no size guidance. The route will sign a URL for a non-image (`presign/route.ts`). Say the rule beside the input even after P0-4 enforces it.

**P2.** `POST /api/settings` returns a fake success (`apps/web/src/app/api/settings/route.ts`). It is unused. It should not survive next to a real save.

**P2.** Presign failures say “backend”. The call never left the Next app.

**P2.** No skip link. No `aria-live` on the only status message (covered in P1-3 and P1-4).

**P2.** Signed-in header is a non-wrapping flex row. Overflow at 390px is **inferred**, not screenshotted.

**P2.** Sign-in Continue on the embedded card was 30px tall at 390px (measured). That is Clerk’s control. Appearance config can raise the hit area if Clerk allows it.

**P3.** `next dev` prints “The middleware file convention is deprecated. Please use proxy instead.” Observed in the server log. Not user-facing. Plan it with the Clerk upgrade so middleware is not rewritten twice.

**P3.** The password-requirements sentence appeared twice in the sign-up page’s text content after a valid password. The screenshot shows the green confirmation once. Likely a polite live-region duplicate. Re-check after the SDK upgrade before spending design time on it.

**P3.** Inconsistent page padding (`p-10` on the landing card, `p-6` on the app) is unfinished layout, not a comprehension bug.

---

## 8. What is working

- Unauthenticated `/dashboard` and `/settings` do not render the app. Curl observed `307` to `/sign-in`. The middleware and the server pages both check the user id.
- The landing page is structurally simple, has `lang="en"`, a viewport meta tag, and no horizontal overflow at 390px. Its own text contrast passes in light and dark.
- The settings form uses a real `<form>`, a required business name, a button that says “Saving...” and disables while the request is in flight, and text for success and failure rather than color alone.
- Currency options that exist are explicit: “AUD — Australian Dollar”, and the same pattern for USD and EUR. The bug is that one option is stored twice, not that the codes are hidden.
- The logo preview has alt text. The file picker is limited to png and jpeg even though the presign route is not.
- Clerk’s sign-up fields have ids and visible labels, including optional first and last name. That part of the third-party card is in better shape than the settings form.
- Focus was visible on a link in a dark-mode probe. This is a narrow check, not a full keyboard pass.
- TypeScript is strict on the web app, and the web lint config includes Next’s accessibility-oriented core-web-vitals rules. Nothing in CI actually renders a page or asserts a workflow.

---

## 9. Top 5, in order

1. **Make account creation finish, on a production Clerk instance, under one product name, with no “Development mode” line** (P0-1, P1-8). Nothing else can be usability-tested with a real session until this works.
2. **Tell the truth about scope, then build one commercial loop** (P0-2, P1-1, P1-7). Remove “Payment Links” from the landing page and dashboard until a merchant can create one and a payer can open one. Do not paint empty modules for agreements, payouts, or revenue share.
3. **Make business settings a record the merchant can trust** (P0-3, P0-5, P1-3, P1-4). Authenticated save and load, one understandable currency decision, human errors, associated labels, a success sentence that clears 4.5:1.
4. **Put dashboard and settings in one frame, and make “no business selected” recoverable on the page that says it** (P1-2, P1-5). Fix `text-neutral-600` on the dark background in the same pass.
5. **Stop cross-organization logo uploads, and give unknown URLs a way home** (P0-4, P1-6). Small, and both are trust failures a payer or a second tenant will eventually hit.

---

## 10. Quick wins

These are small and should not be mistaken for launch.

- Associate the three settings labels with their controls (`htmlFor` / `id`).
- Add `aria-live="polite"` on the settings success and error paragraph.
- Replace “Settings saved successfully!” color with one that measures at least 4.5:1, and name what was saved.
- On the no-organization settings page, link to `/dashboard` and put the organization control on that page. Delete the words “in the header”.
- Delete the dashboard sentence that mentions payment links, until the screen exists.
- Add `app/not-found.tsx` with the product name and a link to `/`.
- Point `body` at the Geist variable already loaded, or stop loading Geist. Do not load both and use Arial by accident.
- Reject non-image content types in `presign/route.ts` and stop reading `orgId` from the body.
- Remove or quarantine `apps/web/src/app/api/settings/route.ts` so a fake `ok: true` cannot be wired to the form.
- Change the presign error string from “backend” to the upload itself.

---

## 11. Design-system gaps to close first

Build these before a second form. Otherwise every new module will copy the settings page.

| Gap | Why it is first |
| --- | --- |
| Semantic color tokens: `surface`, `text`, `text-muted`, `danger`, `success`, each with a dark pair that has been measured at 4.5:1 | `text-neutral-600` and `text-green-600` are already failing. Status badges for payment state will fail the same way if they are picked by eye. |
| One `Button` and one `Field` (label, control, hint, error) | The product has one button and three unlabeled fields. Agreements and payouts will multiply that. |
| An application frame: product name, nav, current business, account | Dashboard and settings are already two different pages pretending to be one product. |
| `EmptyState`, `InlineAlert` (with `aria-live`), and `PageStatus` | The dashboard empty state is a joke about future work. The 404 is the framework default. |
| A status map for money, written in words | The SQL enum already has Draft, Open, Paid, Expired, Canceled. There is no component, no legend, and no rule that status is never color alone. Build the map when the first payment screen is real, not before. |
| Focus style as a token, checked on dark surfaces | Browser outline happened to show in one probe. Clerk’s card and future modals will not inherit a decision the app has not made. |
| Typography: actually use the font the layout loads | Arial versus Geist is the current state. Pick one. |
| Do not add a table, modal, or chart library until a screen needs it | There is no data to put in them. A library will not create the workflows in P0-2. |

---

## 12. What this audit did not do

- Did not open the signed-in dashboard or settings. Clerk rejected sign-up.
- Did not run the Nest API, did not connect to a database, and did not submit a settings save or a logo upload. Those findings are from source, with the UI behavior of sign-up, sign-in, landing, and 404 observed in Chrome.
- Did not see production Clerk branding. “My Application” and “Development mode” are from the keyless development instance this run created.
- Did not measure the signed-in header at 390px. The overflow risk is inferred from the non-wrapping flex row.
- Did not change application code.
