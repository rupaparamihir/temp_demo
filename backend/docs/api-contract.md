# API Contract (Frozen v1)

This document captures the current backend contract that frontend depends on.
Keep paths and response shapes stable for cloud migration.

Base URL: `/api`

## Auth

### `POST /auth/register`
- Body:
```json
{
  "doctorFullName": "string",
  "doctorQualification": "GP|BHMS|BAMS|MBBS|BDS",
  "clinicName": "string",
  "clinicAddress": "string",
  "clinicPincode": "string(6 digits)",
  "clinicCity": "string",
  "clinicState": "string",
  "clinicContactNumber": "string",
  "clinicEmailId": "string",
  "loginPassword": "string",
  "key": "string(5 digits)",
  "consentGiven": true
}
```
- Success `201`:
```json
{
  "token": "jwt",
  "clinic": { "id": "string", "name": "string", "clinicCode": "string" }
}
```

### `POST /auth/login`
- Body:
```json
{ "loginId": "string", "clinicCode": "string(optional)", "password": "string" }
```
- Success `200`:
```json
{
  "token": "jwt",
  "clinic": { "id": "string", "name": "string", "clinicCode": "string" }
}
```

### `GET /auth/me`
- Header: `Authorization: Bearer <token>`
- Success `200`:
```json
{ "clinic": { "id": "string", "name": "string", "clinicCode": "string" } }
```

### `POST /auth/reset-password`
- Body:
```json
{ "contactNumber": "string", "email": "string", "newPassword": "string" }
```
- Success `200`:
```json
{ "message": "Password reset successful" }
```

## Patients

### `POST /patients`
- Header: `Authorization: Bearer <token>`
- Header: `Idempotency-Key: <client-generated-unique-key>` (required, max 128 chars)
- Content-Type: `multipart/form-data`
- Required form fields: `firstName`, `birthYear`, `patientConsent`
- Optional form fields include: `lastName`, `phone`, `gender`, `notes`, `createAppointmentNow`, and appointment/report fields.
- Success `201`:
```json
{
  "patient": { "id": 1, "firstName": "string", "lastName": "string", "birthYear": "1994", "ageYears": 31 },
  "createdAppointment": null
}
```
or
```json
{
  "patient": { "id": 1, "firstName": "string", "lastName": "string", "birthYear": "1994", "ageYears": 31 },
  "createdAppointment": { "id": 10, "appointmentNumber": 1, "visitAt": 1771767082000 }
}
```

### `GET /patients/search`
- Header: `Authorization: Bearer <token>`
- Query: `firstName`, `lastName`, `phone`
- Success `200`:
```json
{ "count": 1, "items": [ { "id": 1, "firstName": "string", "lastName": "string" } ] }
```

### `GET /patients/:patientId/appointments`
- Header: `Authorization: Bearer <token>`
- Success `200`:
```json
{ "count": 2, "items": [ { "id": 10, "appointmentNumber": 1, "visitAt": 1771767082000 } ] }
```

### `POST /patients/:patientId/appointments`
- Header: `Authorization: Bearer <token>`
- Header: `Idempotency-Key: <client-generated-unique-key>` (required, max 128 chars)
- Content-Type: `multipart/form-data`
- Success `201`: appointment object

### `PUT /patients/:patientId/appointments/:appointmentId`
- Header: `Authorization: Bearer <token>`
- Content-Type: `multipart/form-data`
- Success `200`:
```json
{ "id": 10, "appointmentNumber": 1, "visitAt": 1771767082000 }
```

### Legacy-compatible aliases
- `GET /patients/:patientId/cases`
- `POST /patients/:patientId/cases`
- `POST /patients/:patientId/cases/:caseId/appointments`

These currently map to appointment history behavior and should remain stable until frontend deprecates them.

## Summary

### `GET /summary/weekly-patients?weeks=4`
- Success `200`:
```json
{ "count": 4, "items": [ { "weekStart": "2026-02-16", "weekEnd": "2026-02-22", "patientCount": 2 } ] }
```

### `GET /summary/monthly-patients?months=6`
- Success `200`:
```json
{ "count": 6, "items": [ { "month": "2026-02", "monthStart": "2026-02-01", "monthEnd": "2026-02-28", "patientCount": 4 } ] }
```

### `GET /summary/non-repeat-patients`
- Success `200`:
```json
{ "count": 1, "items": [ { "id": 1, "firstName": "string", "lastName": "string", "lastVisitAt": 1771767082000 } ] }
```

## Infra / Debug

### `GET /health`
- Success `200`:
```json
{ "ok": true }
```

### `GET /debug/db-info`
- Success `200`:
```json
{
  "dbFilePath": "H:\\Mihir\\temp\\Den\\backend\\Test.db",
  "counts": { "clinics": 0, "patients": 0, "appointments": 0 }
}
```
