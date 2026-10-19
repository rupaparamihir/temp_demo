# Design Principles

This document is mandatory for all new frontend and backend changes.

## Backend Principles

1. Security-first defaults.
- Never trust frontend input for auth, tenant scope, limits, or audit data.
- Enforce validation and authorization in API and repository layers.

2. Config-driven behavior.
- Business limits and timing values must come from config/env.
- Avoid hardcoded operational constants in route handlers.

3. Data efficiency.
- Store compact, queryable audit fields (integers/enums over large blobs).
- Add only necessary indexes for real query paths.

4. Stable API contracts.
- Keep response shapes predictable and documented.
- Use clear status codes (`400`, `401`, `403`, `404`, `409`, `429`, `500`).
- For throttling, always return `429` with `Retry-After`.

5. Reliability and observability.
- Prefer idempotent and defensive writes where possible.
- Log operational failures with enough context for debugging.

## Frontend Principles

1. Server is source of truth.
- Frontend may guide UX, but backend decides authorization and limits.
- Handle API rejections gracefully and show clear errors.

2. Predictable state management.
- Keep auth/session lifecycle explicit (login, heartbeat, logout, expiry).
- Avoid hidden side effects across unrelated views.

3. Performance and resilience.
- Use low-frequency background activity with jitter for recurring calls.
- Degrade safely on network failures without corrupting local state.

4. Accessibility and usability.
- Forms must provide clear labels, validation feedback, and safe defaults.
- Keep interactions responsive on desktop and mobile.

5. Consistency.
- Reuse shared API helpers and formatting utilities.
- Keep UI behavior consistent for loading, success, and error states.

## Change Checklist

- Does this change preserve tenant isolation?
- Are limits/timeouts configurable via env?
- Are audit-relevant events recorded with minimal storage overhead?
- Are error codes and messages consistent?
- If rate-limited, does response include `Retry-After`?
