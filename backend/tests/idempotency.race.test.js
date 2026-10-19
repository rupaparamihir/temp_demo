import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import * as repository from "../src/data.js";
import { createPatientHandlers } from "../src/app/handlers/patientHandlers.js";
import { createAppointmentHandlers } from "../src/app/handlers/appointmentHandlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../Test.db");

const relaxedLimitsConfig = {
  maxNewPatientsPerClinicPerMinute: 10000,
  dailyPatientLimit: 10000,
  maxAppointmentsPerClinicPerMinute: 10000,
  dailyAppointmentLimit: 10000
};

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function openDb() {
  return new Database(dbPath);
}

async function createTestClinic() {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return repository.addClinic({
    doctorFullName: `Doc ${unique}`,
    doctorQualification: "BDS",
    doctorGender: "M",
    clinicName: `Clinic ${unique}`,
    clinicAddress: "Addr",
    clinicPincode: "400001",
    clinicCity: "Mumbai",
    clinicState: "MH",
    clinicContactNumber: `9${String(unique).replace(/\D/g, "").slice(-9).padStart(9, "0")}`,
    clinicEmailId: `clinic_${unique}@example.com`,
    loginPassword: "password123",
    consentGiven: true
  });
}

await repository.initDataStore();

test("concurrent double-submit with same key creates exactly one patient", async () => {
  const clinic = await createTestClinic();
  const handlers = createPatientHandlers({ repository, config: relaxedLimitsConfig });
  const idempotencyKey = `idem-patient-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const phone = `98${String(Date.now()).slice(-8)}`;

  const requestPayload = {
    user: { sub: clinic.id },
    idempotencyKey,
    body: {
      firstName: "Race",
      lastName: "Case",
      phone,
      birthYear: "1995",
      gender: "Male",
      notes: "test",
      patientConsent: "true"
    },
    reports: []
  };

  const [r1, r2] = await Promise.all([
    handlers.create(requestPayload),
    handlers.create(requestPayload)
  ]);

  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  const valid = (statuses[0] === 201 && statuses[1] === 201) || (statuses[0] === 201 && statuses[1] === 409);
  assert.equal(valid, true, `expected [201,201] or [201,409], got [${statuses.join(",")}]`);

  if (r1.status === 409 || r2.status === 409) {
    const blocked = r1.status === 409 ? r1 : r2;
    assert.deepEqual(blocked.body, {
      ok: false,
      error: "Request in progress",
      retryAfterSeconds: 1
    });
    assert.equal(blocked.headers?.["Retry-After"], "1");
    assert.equal(blocked.headers?.["Idempotency-Key"], idempotencyKey);
  }

  if (r1.status === 201 && r2.status === 201) {
    const replayCount = [r1, r2].filter((r) => r.headers?.["Idempotency-Replayed"] === "true").length;
    assert.equal(replayCount >= 1, true, "expected at least one replayed response when both are 201");
  }

  const db = openDb();
  try {
    const countRow = db
      .prepare("SELECT COUNT(*) AS c FROM patients WHERE clinic_id=? AND first_name=? AND contact_number=?")
      .get(clinic.id, "Race", Number(digitsOnly(phone)));
    assert.equal(Number(countRow?.c || 0), 1, "expected exactly one patient row");
  } finally {
    db.close();
  }
});

test("stale processing idempotency row is taken over and completed", async () => {
  const clinic = await createTestClinic();
  const patient = await repository.addPatient(clinic.id, {
    firstName: "Takeover",
    lastName: "Patient",
    phone: "9876543210",
    birthYear: 1990,
    ageYears: 34,
    gender: "M",
    notes: "",
    consentGiven: true
  });

  const handlers = createAppointmentHandlers({ repository, config: relaxedLimitsConfig });
  const idempotencyKey = `idem-appt-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const staleNow = Date.now() - (2 * 24 * 60 * 60 * 1000);
  const begin = await repository.beginIdempotencyRequest({
    clinicId: clinic.id,
    scope: "appointment_create",
    idempotencyKey,
    now: staleNow,
    ttlMs: 60000,
    processingTtlMs: 1000
  });
  assert.equal(begin.state, "started");

  const result = await handlers.create({
    user: { sub: clinic.id },
    patientId: patient.id,
    idempotencyKey,
    body: {
      bpSystolic: "120",
      bpDiastolic: "80",
      pulse: "72",
      notes: "created after stale takeover"
    },
    reports: []
  });

  assert.equal(result.status, 201, `expected 201 after stale takeover, got ${result.status}`);

  const db = openDb();
  try {
    const apptCount = db
      .prepare("SELECT COUNT(*) AS c FROM appointments WHERE clinic_id=? AND patient_pk=?")
      .get(clinic.id, patient.id);
    assert.equal(Number(apptCount?.c || 0), 1, "expected exactly one appointment row");

    const idemRow = db
      .prepare("SELECT state, status_code FROM idempotency_replays WHERE clinic_id=? AND scope=? AND idempotency_key=?")
      .get(clinic.id, "appointment_create", idempotencyKey);
    assert.equal(String(idemRow?.state || ""), "done", "expected idempotency state to finalize as done");
    assert.equal(Number(idemRow?.status_code || 0), 201, "expected finalized status_code=201");
  } finally {
    db.close();
  }
});
