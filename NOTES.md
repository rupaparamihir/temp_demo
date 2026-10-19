# Project Resume Notes

## Current Status (as of Feb 18, 2026)
- Project: `Clinic Portal` (local MVP)
- Frontend: React + Vite
- Backend: Node.js + Express
- Storage:
  - Clinic/patient/case/appointment data: in-memory
  - Uploaded files: `backend/uploads`
- Authentication:
  - Login + Registration flow available on auth screen
  - Persistent login state in browser `localStorage` (`clinicAuth`)

## Current Auth and Registration Flow
- `Clinic Access` screen has two tabs:
  - `Login` (default selected on load)
  - `Registration`
- Login accepts:
  - `Clinic Code` OR clinic `Contact Number`
  - `Password`
- Registration captures:
  - Doctor Full Name
  - Doctor Qualification (`GP`, `BHMS`, `BAMS`, `MBBS`, `BDS`)
  - Clinic Name
  - Clinic Address
  - Clinic Pincode (6-digit)
  - Clinic City
  - Clinic State
  - Clinic Contact Number (used as clinic id/code for now)
  - Clinic Email Id
  - Login Password
  - Key (5-digit)
  - Consent checkbox for DPDP Act (2023)
- Registration rules:
  - Key must be 5 digits and match backend config (`REGISTRATION_KEY`, default `12345`)
  - Consent is mandatory
  - Contact number and email must be unique
- On successful registration:
  - UI returns to Login tab
  - Auto-login is not performed
  - User is prompted to login with valid details

## Patient and Case Features
- New patient creation with validations:
  - First Name + Surname (letters/spaces, max 30)
  - Phone (>= 10 digits)
  - Gender (`Male`/`Female`)
  - Age format `X year(s)` where X is 1-100
- Patient DPDP consent is mandatory before save:
  - `I am patient giving consent of storing data as per DPDP Act (2023).`
- Optional `Add Case Details Now` in patient creation flow
- Records flow:
  - Search patient by first name/surname
  - Open patient file
  - Open new case (auto datetime)
  - Add follow-up appointment
  - Upload reports/images (including phone camera capture)
  - Historical cases sorted by latest update
  - Appointment numbering auto-increment (`#1`, `#2`, ...)
- Clinical fields:
  - BP, Pulse, CO2, HGT, K/C/O, Notes
- Payment logic:
  - Per appointment, range `-5000` to `5000`
  - Case-level cumulative payment shown
  - `> 0` => `No Payment Pending`
  - `<= 0` => `Payment Left: <value>`

## Summary Section (replaced Updates tab)
- Tab name: `Summary`
- Left panel options:
  - `Weekly Patients`
    - Last 4 weeks
    - Week definition: Monday to Sunday
    - Metric: unique visited patients per week
  - `Monthly Patients`
    - Last 6 months
    - Month definition: 1st day to last day
    - Metric: unique visited patients per month
  - `Non Repeat Patients`
    - Patients with exactly one recorded visit
    - Shows patient details

## API Surface (current)
- Auth
  - `POST /api/auth/login`
  - `POST /api/auth/register`
- Patients / Cases
  - `POST /api/patients`
  - `GET /api/patients/search`
  - `GET /api/patients/:patientId/cases`
  - `POST /api/patients/:patientId/cases`
  - `POST /api/patients/:patientId/cases/:caseId/appointments`
- Summary
  - `GET /api/summary/weekly-patients?weeks=4`
  - `GET /api/summary/monthly-patients?months=6`
  - `GET /api/summary/non-repeat-patients`

## Important Technical Notes
- In-memory storage means all clinic/patient/case data is lost on backend restart.
- Uploaded files remain on disk under `backend/uploads`.
- Backend run script is `node src/server.js` (manual restart needed after backend code changes).
- API returns JSON for known routes; unknown `/api/*` routes return JSON 404 message.

## Environment Notes
- Backend config:
  - `PORT` (default `4000`)
  - `CORS_ORIGIN` (default `http://localhost:5173`)
  - `PUBLIC_BASE_URL` (default `http://localhost:4000`)
  - `JWT_SECRET`
  - `REGISTRATION_KEY` (default `12345`)

## Run Commands
1. Backend
```bash
cd H:\Mihir\temp\Den\backend
npm run dev
```

2. Frontend
```bash
cd H:\Mihir\temp\Den\frontend
npm run dev
```

3. Open
```text
http://localhost:5173/
```

## Next Suggested Steps
1. Move in-memory data to SQL (SQLite locally first, then Cloudflare D1).
2. Move upload storage to object storage (R2) and keep metadata in DB.
3. Add edit/delete flows with audit trail for legal/medical traceability.
4. Add role-based users per clinic (admin/staff).
5. Migrate backend to Cloudflare Workers and frontend to Cloudflare Pages.
