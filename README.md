# Dental Clinic Portal

Clinic-focused web app for patient registration, appointment tracking, and summary views.

## Current stack

- Frontend: React + Vite
- Backend: Node.js + Express (ESM)
- Database: SQLite file (`backend/Test.db`) via `better-sqlite3`

## Runtime versions

- Node.js: `v24.x` (currently tested on `v24.13.1`)
- npm: `11.x` (currently tested on `11.8.0`)

## Major features

- Clinic registration, login, session validation (`/auth/me`), and password reset
- Clinic registration includes doctor full name, qualification, and gender
- Login/logout audit trail with source IP and timestamps
- Clinic-scoped patient data
- New patient registration with DPDP consent enforcement
- Optional first appointment while creating patient
- Follow-up appointment creation and latest-appointment edit flow
- Patient search by first name, surname, phone
- Appointment history and summary endpoints (weekly, monthly, non-repeat)
- File upload support for appointment reports/images
- Daily configurable limits for patient and appointment creation

## Architecture notes

- API contract is documented in `backend/docs/api-contract.md`
- Mandatory engineering standards are documented in `docs/design-principles.md`
- Backend now uses a repository abstraction for future D1 migration:
  - `backend/src/db/index.node.js` (Node provider selection)
  - `backend/src/db/index.worker.js` (Worker provider selection)
  - `backend/src/db/repository.js` (contract reference)
  - `backend/src/db/d1Repo.js` (D1 stub placeholder)
- Active local provider: `sqlite` (implemented through `backend/src/data.js`)
- Runtime split for migration safety:
  - `backend/src/entry/node.js` imports `*.node.js` modules.
  - `backend/src/entry/worker.js` imports `*.worker.js` modules.
  - Config split: `backend/src/config.node.js`, `backend/src/config.worker.js`.
  - Auth split: `backend/src/auth.node.js`, `backend/src/auth.worker.js`.
  - Worker DB split: `backend/src/db/index.worker.js` now builds a D1-backed adapter from Worker binding (`env.DB`, fallback `env.D1_DB`/`env.CLINIC_DB`).

## Project structure

- `backend/` Express API
- `frontend/` React app

## Cloudflare same-domain routing (Pages + Worker)

- Pages serves the frontend on your root domain.
- Worker should be routed only on `/api/*` for the same domain.
- Example Worker route configuration:
  - `routes = [{ pattern = "yourdomain.com/api/*", zone_name = "yourdomain.com" }]`

## Local run

Open two terminals from project root.

### Backend

```bash
cd backend
npm install
npm run dev
```

Backend: `http://localhost:4000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## Environment variables (backend)

- `PORT` (default `4000`)
- `DB_PROVIDER` (default `sqlite`; `d1` currently stubbed)
- `JWT_SECRET` (default `dev_only_change_me`)
- `REGISTRATION_KEY` (default `12345`)
- `PASSWORD_PBKDF2_ITERATIONS` (default `10000`)
- `CORS_ORIGIN` (default empty for Worker same-origin mode; set for local cross-origin dev)
- `PUBLIC_BASE_URL` (default `http://localhost:<PORT>`)
- `DAILY_PATIENT_LIMIT` (default `100`)
- `DAILY_APPOINTMENT_LIMIT` (default `100`)
- `JWT_TTL_HOURS` (default `8`)
- `HEARTBEAT_INTERVAL_MS` (default `300000` = 5 minutes)
- `HEARTBEAT_JITTER_MS` (default `20000`)
- `MAX_CLINIC_REGISTRATIONS_PER_DAY` (default `20`)
- `MAX_NEW_PATIENTS_PER_CLINIC_PER_MINUTE` (default `1`)
- `MAX_PATIENT_SEARCHES_PER_CLINIC_PER_MINUTE` (default `20`)
- `MAX_APPOINTMENTS_PER_CLINIC_PER_MINUTE` (default `1`)
- `MAX_UNAUTH_REQUESTS_PER_IP_PER_MINUTE` (default `10`; applies to `/auth/register`, `/auth/login`, `/auth/reset-password`)
- `MAX_FAILED_LOGINS_PER_IDENTIFIER_IP_PER_MINUTE` (default `5`)
- `FAILED_LOGIN_IDENTIFIER_IP_COOLDOWN_SECONDS` (default `60`)
- `MAX_FAILED_LOGINS_PER_IDENTIFIER_IN_FIVE_MINUTES` (default `20`)
- `FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL1_SECONDS` (default `120` = 2 minutes)
- `FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL2_SECONDS` (default `900` = 15 minutes)
- `FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL3_SECONDS` (default `1800` = 30 minutes)
- `REQUEST_LATENCY_RETENTION_HOURS` (default `48`)
- `REQUEST_LATENCY_PURGE_START_HOUR` (default `2`)
- `REQUEST_LATENCY_PURGE_END_HOUR` (default `5`)
- `REQUEST_LATENCY_PURGE_SAMPLE_RATE_PERCENT` (default `5`)
- `ALLOW_SCHEMA_CREATE` (Worker only; default `false`; set `true` only for one-time D1 bootstrap)

## Environment variables (frontend, optional)

- `VITE_API_BASE` (default `/api`; for same-domain Pages + Worker setup)
- `VITE_HEARTBEAT_INTERVAL_MS` (default `300000` = 5 minutes)
- `VITE_HEARTBEAT_JITTER_MS` (default `20000`)

## API endpoints (high-level)

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/ping`
- `POST /api/auth/logout`
- `POST /api/auth/reset-password`

### Patients & appointments

- `POST /api/patients`
- `GET /api/patients/search`
- `GET /api/patients/:patientId/appointments`
- `POST /api/patients/:patientId/appointments`
- `PUT /api/patients/:patientId/appointments/:appointmentId`

### Summary

- `GET /api/summary/weekly-patients`
- `GET /api/summary/monthly-patients`
- `GET /api/summary/non-repeat-patients`

### Compatibility aliases

- `GET /api/patients/:patientId/cases`
- `POST /api/patients/:patientId/cases`
- `POST /api/patients/:patientId/cases/:caseId/appointments`

### Infra / debug

- `GET /api/health`
- `GET /api/debug/db-info`

## Data notes

- Data is persisted in `backend/Test.db` and survives frontend/backend restarts.
- Storage-oriented schema notes:
  - `clinics.id` is integer PK and tenant FK target across tables.
  - `clinics.doctor_gender` stores compact code (`M`/`F`).
  - `patients.patient_pk` is internal PK; API still exposes it as `id`.
  - `patients.clinic_patient_id` is clinic-local running number (separate from internal PK).
  - `patients.contact_number` is stored as integer; API response still returns `phone` for compatibility.
  - `patients.gender` is stored as `M`/`F`; API returns `Male`/`Female`.
  - `patients.consent_given` is stored as `Y`/`N`.
- Audit tables are persisted in the same DB:
  - `login_audit_sessions` (clinic login/logout + IP)
  - `appointment_audit_log` (appointment create/update events)
  - `clinic_minute_counters` (compact per-minute counters for throttling)
- No demo clinic is auto-created now. Create a clinic via registration before login.

# temp_demo
