# AJAX Implementation in EventEase

This document explains how asynchronous data retrieval (AJAX) was added to
EventEase for the Customer Experience Design and Programming course, without
changing the existing UI/UX, routes, or visual design.

## What AJAX means

AJAX (Asynchronous JavaScript and XML — in practice today, usually JSON, not
XML) is the technique of having a web page request data from a server in the
background and update itself with the response, **without doing a full page
reload**. The term is historical; the mechanism EventEase uses is the modern
native browser **Fetch API**, not `XMLHttpRequest` or jQuery's `$.ajax()`.

## Why EventEase uses asynchronous requests

EventEase is a single-page React application (client-side routing via
`react-router-dom`). Before this change, all event data was a hardcoded
TypeScript array imported directly into every page (`mockEvents.ts`). That
meant "loading data" was instantaneous and synchronous — not representative
of how a real application talks to a server.

This change moves the event data into a JSON file and retrieves it with
`fetch()`, so the app behaves like it would against a real API:
- data arrives after a request completes,
- the UI must show a loading state while waiting,
- the UI must handle the request failing,
- and none of this requires reloading the page or leaving React's SPA model.

## Where AJAX is used

| Feature | Service | Data source |
|---|---|---|
| Event listings (Home, Explore, Details, Calendar, My Events) | [`src/services/eventService.ts`](src/services/eventService.ts) | [`public/data/events.json`](public/data/events.json) |
| Notification dropdown (Navbar) | [`src/services/notificationService.ts`](src/services/notificationService.ts) | [`public/data/notifications.json`](public/data/notifications.json) |
| Event registration (mocked, no backend) | [`src/services/registrationService.ts`](src/services/registrationService.ts) | simulated response only |

Events are fetched once, on app start, by [`EventsProvider`](src/context/EventsContext.tsx)
and shared with every page via the `useEvents()` hook (React Context). This
means navigating between Home → Explore → Event Details → Calendar → My Events
does **not** re-fetch `events.json` each time — the service module also keeps
an in-memory cache as a second layer of protection against duplicate requests.

Notifications are fetched on demand, the first time the bell dropdown is
opened, as a smaller/simpler example of the same pattern.

## Request/response flow

```
React component (e.g. Home.tsx)
        │  useEvents()
        ▼
EventsContext (fetches once on mount, holds { events, loading, error })
        │  fetchEvents()
        ▼
eventService.ts  ── fetch('/data/events.json') ──▶  events.json (static file, stands in for a real API)
        │
        ▼
   JSON response (Response.json())
        │
        ▼
   React state (events, loading, error)
        │
        ▼
        UI (event cards, calendar cells, etc.)
```

Registration follows a parallel but separate flow, since it is a write
operation and EventEase has no real backend:

```
Register.tsx → registrationService.registerForEvent(payload)
             → simulated async delay (stand-in for a POST request)
             → { success, registrationId } returned to the component
             → navigate to the confirmation page
```

## JSON data source

- `public/data/events.json` — the exact event records that previously lived
  in `mockEvents.ts`, now served as a static file. In dev (`vite`) and in the
  production build (`vite build`), anything under `public/` is served/copied
  as-is at the site root, so `fetch('/data/events.json')` works identically
  in both.
- `public/data/notifications.json` — a small list of notification objects
  for the navbar dropdown.

Serving these as static JSON is a deliberate simplification for this
frontend-only project — the request/response mechanics are identical to
calling a real REST endpoint that returns JSON.

## Loading state

Each page that depends on `useEvents()` checks `loading` and renders a
skeleton grid ([`EventCardSkeletonGrid`](src/components/EventCardSkeleton.tsx))
or an inline skeleton (Event Details, Calendar) instead of showing blank or
stale content while the fetch is in flight.

## Error handling

If `fetch()` rejects or returns a non-OK status, `EventsContext` sets an
`error` message and every consuming page renders the shared
[`ErrorState`](src/components/ErrorState.tsx) component:

> "Unable to load events. Please try again."

with a **Retry** button that calls `refetch()`, which re-runs `fetchEvents({ force: true })`
and clears the in-memory cache so a genuinely new request is made.

## How this could later connect to a real backend API

Because all data access goes through the service layer, swapping the mock
JSON for a real backend requires changes in exactly one place per feature,
with no changes to any page component:

- **Events**: change `EVENTS_URL` in `eventService.ts` from `/data/events.json`
  to something like `https://api.eventease.cutm.ac.in/events`. The rest of
  `fetchEvents()` (caching, error handling) stays the same.
- **Notifications**: same idea in `notificationService.ts`.
- **Registration**: replace the simulated delay in `registrationService.ts`
  with a real `POST`:
  ```ts
  const response = await fetch('/api/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Registration failed');
  return response.json();
  ```

No page component imports `fetch` directly — they only call service
functions — which is what makes this swap possible without touching the UI.
