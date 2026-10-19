import { hashPassword, verifyPassword } from "../password.js";

const nowTs = () => Date.now();
const digitsOnly = (v) => String(v || "").replace(/\D/g, "");
const toAmount = (value) => {
  const n = Number(String(value ?? "").trim().replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-5000, Math.min(5000, n));
};
const toPaise = (value) => Math.round(toAmount(value) * 100);
const fromPaise = (value) => Number(value || 0) / 100;
const toPatientContactNumber = (value) => {
  const digits = digitsOnly(value);
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};
const buildPhoneRange = (digits) => {
  const v = String(digits || "").trim();
  if (!/^\d{1,10}$/.test(v)) return null;
  if (v.length === 10) {
    const exact = Number(v);
    return Number.isFinite(exact) ? { low: exact, high: exact } : null;
  }
  const padLen = 10 - v.length;
  const low = Number(v + "0".repeat(padLen));
  const high = Number(v + "9".repeat(padLen));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
};
const toConsentFlag = (value) => (value ? "Y" : "N");
const fromConsentFlag = (value) => String(value || "").toUpperCase() === "Y";
const toGenderCode = (value) => {
  const v = String(value || "").trim().toUpperCase();
  if (v === "M" || v === "MALE") return "M";
  if (v === "F" || v === "FEMALE") return "F";
  return "";
};
const fromGenderCode = (value) => {
  const v = String(value || "").trim().toUpperCase();
  if (v === "M") return "Male";
  if (v === "F") return "Female";
  return "";
};

const mapClinic = (r) => r ? ({
  id: Number(r.id),
  name: r.name,
  clinicCode: r.clinic_code,
  doctorFullName: r.doctor_full_name,
  doctorQualification: r.doctor_qualification,
  doctorGender: fromGenderCode(r.doctor_gender),
  clinicAddress: r.clinic_address,
  clinicPincode: String(r.clinic_pincode || ""),
  clinicCity: r.clinic_city,
  clinicState: r.clinic_state,
  contactNumber: r.contact_number,
  email: r.email,
  consentGiven: Boolean(r.consent_given),
  passwordHash: r.password_hash,
  createdAt: Number(r.created_at || 0),
  updatedAt: Number(r.updated_at || 0)
}) : null;

const mapPatient = (r) => r ? ({
  id: Number(r.patient_pk),
  clinicId: Number(r.clinic_id),
  clinicPatientId: Number(r.clinic_patient_id),
  firstName: r.first_name,
  lastName: r.last_name || "",
  phone: r.contact_number === null || r.contact_number === undefined ? "" : String(r.contact_number),
  birthYear: String(r.birth_year || ""),
  ageYears: Number(r.age_years || 0),
  age: `${Number(r.age_years || 0)} year`,
  gender: fromGenderCode(r.gender),
  notes: r.notes || "",
  consentGiven: fromConsentFlag(r.consent_given),
  medicalHistory: r.medical_history || "NO",
  createdAt: Number(r.created_at || 0),
  updatedAt: Number(r.updated_at || 0)
}) : null;

function mapAppointment(r) {
  if (!r) return null;
  let reports = [];
  try { reports = JSON.parse(r.reports_json || "[]"); } catch { reports = []; }
  return {
    id: Number(r.id),
    appointmentNumber: Number(r.appointment_number || 0),
    visitAt: Number(r.visit_at || 0),
    bpSystolic: r.bp_systolic === null ? null : Number(r.bp_systolic),
    bpDiastolic: r.bp_diastolic === null ? null : Number(r.bp_diastolic),
    pulse: r.pulse || "",
    oxygenLevel: r.oxygen_level || "",
    sugar: r.sugar || "",
    thyroid: r.thyroid || "",
    weight: r.weight || "",
    temperature: r.temperature || "",
    pastHistoryCondition: r.past_history_condition || "",
    pastHistory: r.past_history || "",
    paymentAmount: fromPaise(r.payment_amount),
    notes: r.notes || "",
    reports,
    createdAt: Number(r.created_at || 0),
    updatedAt: Number(r.updated_at || 0)
  };
}

function parseHistory(value = "") {
  return String(value || "").split(",").map((x) => x.trim()).filter((x) => x && x.toUpperCase() !== "NO");
}

function getTodayRange(now = nowTs()) {
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);
  const e = new Date(now);
  e.setHours(23, 59, 59, 999);
  return { start: s.getTime(), end: e.getTime() };
}
function isWithinPurgeWindow(config = {}, now = nowTs()) {
  const hour = new Date(now).getHours();
  const start = Math.max(0, Math.min(23, Number(config?.requestLatencyPurgeStartHour ?? 2)));
  const end = Math.max(0, Math.min(23, Number(config?.requestLatencyPurgeEndHour ?? 5)));
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
function shouldRunLatencyPurge(config = {}) {
  const pct = Math.max(1, Math.min(100, Number(config?.requestLatencyPurgeSampleRatePercent) || 5));
  return Math.random() * 100 < pct;
}
function normalizeLimitOffset(options = {}, defaults = {}) {
  const defaultLimit = Math.max(1, Number(defaults.defaultLimit) || 20);
  const maxLimit = Math.max(defaultLimit, Number(defaults.maxLimit) || 100);
  const limit = Math.max(1, Math.min(maxLimit, Number(options?.limit) || defaultLimit));
  const offset = Math.max(0, Number(options?.offset) || 0);
  const cursorUpdatedAt = options?.cursorUpdatedAt === undefined || options?.cursorUpdatedAt === null
    ? null
    : Number(options.cursorUpdatedAt);
  const cursorPatientPk = options?.cursorPatientPk === undefined || options?.cursorPatientPk === null
    ? null
    : Number(options.cursorPatientPk);
  const cursorVisitAt = options?.cursorVisitAt === undefined || options?.cursorVisitAt === null
    ? null
    : Number(options.cursorVisitAt);
  const cursorAppointmentId = options?.cursorAppointmentId === undefined || options?.cursorAppointmentId === null
    ? null
    : Number(options.cursorAppointmentId);
  return {
    limit,
    offset,
    cursorUpdatedAt: Number.isFinite(cursorUpdatedAt) ? cursorUpdatedAt : null,
    cursorPatientPk: Number.isFinite(cursorPatientPk) ? cursorPatientPk : null,
    cursorVisitAt: Number.isFinite(cursorVisitAt) ? cursorVisitAt : null,
    cursorAppointmentId: Number.isFinite(cursorAppointmentId) ? cursorAppointmentId : null
  };
}

function requireD1(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("D1 database binding is missing. Configure env.DB (or D1_DB/CLINIC_DB) in Worker.");
  }
}

async function run(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).run();
  return result || {};
}

async function one(db, sql, params = []) {
  const row = await db.prepare(sql).bind(...params).first();
  return row || null;
}

async function many(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function batch(db, statements = []) {
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...(s.params || [])));
  return db.batch(prepared);
}

async function refreshMedicalHistory(db, patientId) {
  const rows = await many(db, "SELECT past_history_condition FROM appointments WHERE patient_pk=?", [Number(patientId)]);
  const set = new Set();
  rows.forEach((r) => parseHistory(r.past_history_condition || "").forEach((x) => set.add(x)));
  const value = set.size ? Array.from(set).join(", ") : "NO";
  await run(db, "UPDATE patients SET medical_history=?, updated_at=? WHERE patient_pk=?", [value, nowTs(), Number(patientId)]);
}

async function logAppointmentAudit(db, action, clinicId, patientId, appointmentRow) {
  if (!appointmentRow) return;
  const ts = nowTs();
  await run(
    db,
    `INSERT INTO appointment_audit_log
      (clinic_id,patient_pk,appointment_id,action,event_at,appointment_created_at,appointment_updated_at)
      VALUES (?,?,?,?,?,?,?)`,
    [
      Number(clinicId),
      Number(patientId),
      Number(appointmentRow.id),
      String(action || "U"),
      ts,
      Number(appointmentRow.created_at || ts),
      Number(appointmentRow.updated_at || ts)
    ]
  );
}

async function incrementClinicMinuteCounter(db, clinicId, action, now = nowTs(), readBack = true) {
  const ts = Number(now) || nowTs();
  const bucket = Math.floor(ts / 60000) * 60000;
  const cid = Number(clinicId);
  const act = String(action || "").trim();
  await run(
    db,
    `INSERT INTO clinic_minute_counters (clinic_id,action,bucket_start,count,created_at,updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(clinic_id, action, bucket_start)
     DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
    [cid, act, bucket, ts, ts]
  );
  if (!readBack) {
    if (Math.random() < 0.01) {
      await run(db, "DELETE FROM clinic_minute_counters WHERE bucket_start < ?", [ts - 48 * 60 * 60 * 1000]);
    }
    return null;
  }
  const row = await one(db, "SELECT count FROM clinic_minute_counters WHERE clinic_id=? AND action=? AND bucket_start=?", [cid, act, bucket]);
  if (Math.random() < 0.01) {
    await run(db, "DELETE FROM clinic_minute_counters WHERE bucket_start < ?", [ts - 48 * 60 * 60 * 1000]);
  }
  return Number(row?.count || 0);
}

function createSchemaSql() {
  return `
CREATE TABLE IF NOT EXISTS clinics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  clinic_code TEXT NOT NULL UNIQUE,
  doctor_full_name TEXT NOT NULL,
  doctor_qualification TEXT NOT NULL,
  doctor_gender TEXT NOT NULL DEFAULT '',
  clinic_address TEXT NOT NULL,
  clinic_pincode INTEGER NOT NULL,
  clinic_city TEXT NOT NULL,
  clinic_state TEXT NOT NULL,
  contact_number TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  consent_given INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  patient_pk INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  clinic_patient_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  contact_number INTEGER,
  birth_year INTEGER NOT NULL,
  age_years INTEGER NOT NULL,
  gender TEXT,
  notes TEXT,
  consent_given TEXT NOT NULL DEFAULT 'N',
  medical_history TEXT NOT NULL DEFAULT 'NO',
  last_appointment_no INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (clinic_id, clinic_patient_id),
  CHECK (clinic_patient_id >= 1 AND clinic_patient_id <= 9999)
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  patient_pk INTEGER NOT NULL,
  appointment_number INTEGER NOT NULL,
  visit_at INTEGER NOT NULL,
  bp_systolic INTEGER,
  bp_diastolic INTEGER,
  pulse TEXT,
  oxygen_level TEXT,
  sugar TEXT,
  thyroid TEXT,
  weight TEXT,
  temperature TEXT,
  past_history_condition TEXT,
  past_history TEXT,
  payment_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  reports_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (patient_pk, appointment_number)
);
CREATE TABLE IF NOT EXISTS login_audit_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  login_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  logout_at INTEGER,
  end_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS appointment_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  patient_pk INTEGER NOT NULL,
  appointment_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('C','U')),
  event_at INTEGER NOT NULL,
  appointment_created_at INTEGER NOT NULL,
  appointment_updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clinic_minute_counters (
  clinic_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (clinic_id, action, bucket_start)
);
CREATE TABLE IF NOT EXISTS idempotency_replays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 0,
  response_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'done',
  processing_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (clinic_id, scope, idempotency_key)
);
CREATE TABLE IF NOT EXISTS request_latency_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  route TEXT NOT NULL,
  clinic_id INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clinics_code ON clinics(clinic_code);
CREATE INDEX IF NOT EXISTS idx_clinics_contact ON clinics(contact_number);
CREATE INDEX IF NOT EXISTS idx_clinics_email ON clinics(email);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_name ON patients(clinic_id, first_name, last_name, patient_pk);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_name_lc ON patients(clinic_id, lower(first_name), lower(last_name), patient_pk);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_contact ON patients(clinic_id, contact_number);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_visit ON appointments(clinic_id, patient_pk, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_latest ON appointments(clinic_id, patient_pk, visit_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_clinic_time ON login_audit_sessions(clinic_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_audit_clinic_time ON appointment_audit_log(clinic_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_minute_counters_bucket ON clinic_minute_counters(bucket_start);
CREATE INDEX IF NOT EXISTS idx_idempotency_replays_exp ON idempotency_replays(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_replays_processing ON idempotency_replays(state, processing_expires_at);
CREATE INDEX IF NOT EXISTS idx_request_latency_metrics_created ON request_latency_metrics(created_at);
`;
}

async function ensurePatientAppointmentCounterColumn(db) {
  const hasPatients = await one(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='patients' LIMIT 1"
  );
  if (!hasPatients) return;
  const cols = await many(db, "PRAGMA table_info(patients)");
  const hasCounter = cols.some(
    (c) => String(c?.name || "").toLowerCase() === "last_appointment_no"
  );
  if (hasCounter) return;
  await run(db, "ALTER TABLE patients ADD COLUMN last_appointment_no INTEGER NOT NULL DEFAULT 0");
  await run(
    db,
    `UPDATE patients
      SET last_appointment_no = COALESCE((
        SELECT MAX(a.appointment_number)
        FROM appointments a
        WHERE a.patient_pk = patients.patient_pk
      ), 0)`
  );
}

async function ensureIdempotencyColumns(db) {
  const hasTable = await one(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_replays' LIMIT 1"
  );
  if (!hasTable) return;
  const cols = await many(db, "PRAGMA table_info(idempotency_replays)");
  const hasState = cols.some((c) => String(c?.name || "").toLowerCase() === "state");
  const hasProcessingExp = cols.some((c) => String(c?.name || "").toLowerCase() === "processing_expires_at");
  const hasUpdated = cols.some((c) => String(c?.name || "").toLowerCase() === "updated_at");
  if (!hasState) {
    await run(db, "ALTER TABLE idempotency_replays ADD COLUMN state TEXT NOT NULL DEFAULT 'done'");
  }
  if (!hasProcessingExp) {
    await run(db, "ALTER TABLE idempotency_replays ADD COLUMN processing_expires_at INTEGER");
  }
  if (!hasUpdated) {
    await run(db, "ALTER TABLE idempotency_replays ADD COLUMN updated_at INTEGER");
  }
  await run(
    db,
    "UPDATE idempotency_replays SET state=COALESCE(state,'done') WHERE state IS NULL OR state=''"
  );
  await run(
    db,
    "UPDATE idempotency_replays SET updated_at=COALESCE(updated_at, created_at, ?) WHERE updated_at IS NULL",
    [nowTs()]
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_idempotency_replays_processing ON idempotency_replays(state, processing_expires_at)"
  );
}

export function createD1Repository(db, config = {}, options = {}) {
  const passwordIterations = Math.max(10000, Number(config.passwordPbkdf2Iterations) || 10000);
  const allowSchemaCreate = config?.allowSchemaCreate === true;
  const deferTask = typeof options?.deferTask === "function" ? options.deferTask : null;
  return {
    async initDataStore() {
      requireD1(db);
      if (allowSchemaCreate) {
        await db.exec(createSchemaSql());
        await ensurePatientAppointmentCounterColumn(db);
        await ensureIdempotencyColumns(db);
        return;
      }
      try {
        await db.prepare("SELECT 1 FROM clinics LIMIT 1").first();
        await ensurePatientAppointmentCounterColumn(db);
        await ensureIdempotencyColumns(db);
      } catch (err) {
        throw new Error(
          "D1 schema is missing or not migrated. Run Wrangler migrations before deploy, or set ALLOW_SCHEMA_CREATE=true for one-time bootstrap."
        );
      }
    },

    async findClinicByCode(clinicCode) {
      requireD1(db);
      const value = String(clinicCode || "").trim();
      if (!value) return null;
      const row = await one(
        db,
        "SELECT * FROM clinics WHERE clinic_code=? OR contact_number=? OR contact_number=? LIMIT 1",
        [value, value, digitsOnly(value)]
      );
      return mapClinic(row);
    },

    async findClinicById(clinicId) {
      requireD1(db);
      const value = String(clinicId || "").trim();
      if (!value) return null;
      const row = await one(db, "SELECT * FROM clinics WHERE id=? LIMIT 1", [value]);
      return mapClinic(row);
    },

    async verifyClinicPassword(clinic, password) {
      return verifyPassword(String(password || ""), clinic?.passwordHash || "");
    },

    async recordLoginSession({ clinicId, sessionId, ipAddress, loginAt = nowTs(), expiresAt = null }) {
      requireD1(db);
      const ts = Number(loginAt) || nowTs();
      const exp = Number(expiresAt) || (ts + 8 * 60 * 60 * 1000);
      await run(
        db,
        `INSERT INTO login_audit_sessions (clinic_id,session_id,ip_address,login_at,last_seen_at,expires_at,logout_at,end_reason,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          Number(clinicId),
          String(sessionId || "").trim(),
          String(ipAddress || "unknown").slice(0, 45),
          ts,
          ts,
          exp,
          null,
          null,
          ts,
          ts
        ]
      );
    },

    async recordLogoutSession(clinicId, sessionId, logoutAt = nowTs(), ipAddress = "") {
      requireD1(db);
      const ts = Number(logoutAt) || nowTs();
      const cid = Number(clinicId);
      const sid = String(sessionId || "").trim();
      if (!cid) return false;

      if (sid) {
        const updated = await run(
          db,
          `UPDATE login_audit_sessions
             SET logout_at=?, end_reason='explicit', updated_at=?
           WHERE clinic_id=? AND session_id=? AND logout_at IS NULL`,
          [ts, ts, cid, sid]
        );
        if (Number(updated?.meta?.changes || 0) > 0) return true;
      }

      const ip = String(ipAddress || "").trim();
      const row = await one(
        db,
        `SELECT id FROM login_audit_sessions
         WHERE clinic_id=? AND logout_at IS NULL AND (?='' OR ip_address=?)
         ORDER BY login_at DESC
         LIMIT 1`,
        [cid, ip, ip]
      );
      if (!row?.id) return false;
      const fallback = await run(
        db,
        "UPDATE login_audit_sessions SET logout_at=?, end_reason='explicit', updated_at=? WHERE id=?",
        [ts, ts, Number(row.id)]
      );
      return Number(fallback?.meta?.changes || 0) > 0;
    },

    async touchSessionHeartbeat(clinicId, sessionId, seenAt = nowTs()) {
      requireD1(db);
      const cid = Number(clinicId);
      const sid = String(sessionId || "").trim();
      if (!cid || !sid) return false;
      const ts = Number(seenAt) || nowTs();
      const result = await run(
        db,
        `UPDATE login_audit_sessions
           SET last_seen_at=?, updated_at=?
         WHERE clinic_id=? AND session_id=? AND logout_at IS NULL`,
        [ts, ts, cid, sid]
      );
      return Number(result?.meta?.changes || 0) > 0;
    },

    async validateSession(clinicId, sessionId, now = nowTs()) {
      requireD1(db);
      const cid = Number(clinicId);
      const sid = String(sessionId || "").trim();
      if (!cid || !sid) return false;
      const row = await one(
        db,
        `SELECT id FROM login_audit_sessions
          WHERE clinic_id=? AND session_id=? AND logout_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1`,
        [cid, sid, Number(now) || nowTs()]
      );
      return Boolean(row?.id);
    },

    async countClinicsRegisteredToday() {
      requireD1(db);
      const { start, end } = getTodayRange();
      const row = await one(
        db,
        "SELECT COUNT(*) AS c FROM clinics WHERE created_at >= ? AND created_at <= ?",
        [start, end]
      );
      return Number(row?.c || 0);
    },

    async countPatientsAddedInLastMinute(clinicId, now = nowTs()) {
      requireD1(db);
      const ts = Number(now) || nowTs();
      const bucket = Math.floor(ts / 60000) * 60000;
      const row = await one(
        db,
        "SELECT count FROM clinic_minute_counters WHERE clinic_id=? AND action='patient_add' AND bucket_start=?",
        [Number(clinicId), bucket]
      );
      return Number(row?.count || 0);
    },

    async countAppointmentsAddedInLastMinute(clinicId, now = nowTs()) {
      requireD1(db);
      const ts = Number(now) || nowTs();
      const bucket = Math.floor(ts / 60000) * 60000;
      const row = await one(
        db,
        "SELECT count FROM clinic_minute_counters WHERE clinic_id=? AND action='appointment_add' AND bucket_start=?",
        [Number(clinicId), bucket]
      );
      return Number(row?.count || 0);
    },

    async incrementPatientSearchCounter(clinicId, now = nowTs()) {
      requireD1(db);
      return incrementClinicMinuteCounter(db, clinicId, "patient_search", now);
    },

    async resetClinicPassword(contactNumber, email, newPassword) {
      requireD1(db);
      const row = await one(
        db,
        "SELECT id FROM clinics WHERE contact_number=? AND LOWER(email)=? LIMIT 1",
        [digitsOnly(contactNumber), String(email || "").trim().toLowerCase()]
      );
      if (!row?.id) return false;
      const hash = await hashPassword(String(newPassword || ""), passwordIterations);
      const result = await run(db, "UPDATE clinics SET password_hash=?, updated_at=? WHERE id=?", [hash, nowTs(), Number(row.id)]);
      return Number(result?.meta?.changes || 0) > 0;
    },

    async addClinic(payload) {
      requireD1(db);
      const contactNumber = digitsOnly(payload?.clinicContactNumber);
      const clinicEmail = String(payload?.clinicEmailId || "").trim().toLowerCase();
      const [contactExistsRes, emailExistsRes] = await batch(db, [
        { sql: "SELECT id FROM clinics WHERE contact_number=? LIMIT 1", params: [contactNumber] },
        { sql: "SELECT id FROM clinics WHERE LOWER(email)=? LIMIT 1", params: [clinicEmail] }
      ]);
      if (contactExistsRes?.results?.length) {
        throw new Error("Clinic contact number is already registered");
      }
      if (emailExistsRes?.results?.length) {
        throw new Error("Clinic email id is already registered");
      }

      const ts = nowTs();
      const hash = await hashPassword(String(payload?.loginPassword || ""), passwordIterations);
      const row = await one(
        db,
        `INSERT INTO clinics
          (name,clinic_code,doctor_full_name,doctor_qualification,doctor_gender,clinic_address,clinic_pincode,clinic_city,clinic_state,contact_number,email,consent_given,password_hash,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING *`,
        [
          String(payload?.clinicName || "").trim(),
          contactNumber,
          String(payload?.doctorFullName || "").trim(),
          String(payload?.doctorQualification || "").trim(),
          toGenderCode(payload?.doctorGender),
          String(payload?.clinicAddress || "").trim(),
          Number(String(payload?.clinicPincode || "").replace(/\D/g, "")) || 0,
          String(payload?.clinicCity || "").trim(),
          String(payload?.clinicState || "").trim(),
          contactNumber,
          clinicEmail,
          payload?.consentGiven ? 1 : 0,
          hash,
          ts,
          ts
        ]
      );
      return mapClinic(row);
    },

    async addPatient(clinicId, payload) {
      requireD1(db);
      const cid = Number(clinicId);
      const ts = nowTs();
      const row = await one(
        db,
        `INSERT INTO patients
          (clinic_id,clinic_patient_id,first_name,last_name,contact_number,birth_year,age_years,gender,notes,consent_given,medical_history,created_at,updated_at)
         SELECT
          ?,
          COALESCE((SELECT MAX(clinic_patient_id)+1 FROM patients WHERE clinic_id=?), 1),
          ?, ?, ?, ?, ?, ?, ?, ?, 'NO', ?, ?
         WHERE COALESCE((SELECT MAX(clinic_patient_id)+1 FROM patients WHERE clinic_id=?), 1) <= 9999
         RETURNING *`,
        [
          cid,
          cid,
          String(payload?.firstName || "").trim(),
          String(payload?.lastName || "").trim(),
          toPatientContactNumber(payload?.phone || payload?.contactNumber),
          Number(payload?.birthYear),
          Number(payload?.ageYears),
          toGenderCode(payload?.gender),
          String(payload?.notes || ""),
          toConsentFlag(payload?.consentGiven),
          ts,
          ts,
          cid
        ]
      );
      if (!row) throw new Error("Clinic patient id limit reached (max 9999)");
      await incrementClinicMinuteCounter(db, clinicId, "patient_add", ts, false);
      return mapPatient(row);
    },

    async patientExistsForClinic(clinicId, firstName, lastName = "", birthYear = "", phone = "", gender = "") {
      requireD1(db);
      const rows = await many(
        db,
        `SELECT contact_number FROM patients
         WHERE clinic_id=? AND LOWER(first_name)=? AND LOWER(COALESCE(last_name,''))=?
           AND CAST(birth_year AS TEXT)=? AND UPPER(COALESCE(gender,''))=?`,
        [
          Number(clinicId),
          String(firstName || "").trim().toLowerCase(),
          String(lastName || "").trim().toLowerCase(),
          String(birthYear || "").trim(),
          toGenderCode(gender)
        ]
      );
      if (!rows.length) return false;
      const p = digitsOnly(phone);
      return rows.some((r) => digitsOnly(String(r.contact_number || "")) === p);
    },

    async searchPatients(clinicId, firstName = "", lastName = "", phone = "", options = {}) {
      requireD1(db);
      const { limit, offset, cursorUpdatedAt, cursorPatientPk } = normalizeLimitOffset(options, { defaultLimit: 20, maxLimit: 100 });
      const firstNameValue = String(firstName || "").trim().toLowerCase();
      const lastNameValue = String(lastName || "").trim().toLowerCase();
      const phoneDigits = digitsOnly(phone);
      const phoneRange = buildPhoneRange(phoneDigits);
      const rows = await many(
        db,
        `SELECT * FROM patients
         WHERE clinic_id=?
           AND (?='' OR LOWER(first_name) LIKE ?)
           AND (?='' OR LOWER(COALESCE(last_name,'')) LIKE ?)
           AND (?='' OR (? IS NOT NULL AND contact_number >= ? AND contact_number <= ?))
           AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND patient_pk < ?))
         ORDER BY updated_at DESC, patient_pk DESC
         LIMIT ? OFFSET ?`,
        [
          Number(clinicId),
          firstNameValue,
          firstNameValue ? `${firstNameValue}%` : "",
          lastNameValue,
          lastNameValue ? `${lastNameValue}%` : "",
          phoneDigits,
          phoneRange ? phoneRange.low : null,
          phoneRange ? phoneRange.low : null,
          phoneRange ? phoneRange.high : null,
          cursorUpdatedAt,
          cursorUpdatedAt,
          cursorUpdatedAt,
          cursorPatientPk,
          limit,
          offset
        ]
      );
      return rows.map(mapPatient);
    },

    async addAppointment(clinicId, patientId, payload, reports = []) {
      requireD1(db);
      const cid = Number(clinicId);
      const pid = Number(patientId);
      const ts = nowTs();
      const reportsJson = JSON.stringify((reports || []).map((r) => ({
        id: `rep_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        name: r.name,
        url: r.url,
        mimeType: r.mimeType,
        size: r.size,
        uploadedAt: nowTs()
      })));

      const counterRow = await one(
        db,
        `UPDATE patients
          SET last_appointment_no = COALESCE(last_appointment_no, 0) + 1
          WHERE patient_pk=? AND clinic_id=?
          RETURNING last_appointment_no AS appointment_number`,
        [pid, cid]
      );
      if (!counterRow) return null;

      const insertedRow = await one(
        db,
        `INSERT INTO appointments
          (clinic_id,patient_pk,appointment_number,visit_at,bp_systolic,bp_diastolic,pulse,oxygen_level,sugar,thyroid,weight,temperature,past_history_condition,past_history,payment_amount,notes,reports_json,created_at,updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          cid,
          pid,
          Number(counterRow.appointment_number || 1),
          ts,
          payload?.bpSystolic ?? null,
          payload?.bpDiastolic ?? null,
          payload?.pulse || "",
          payload?.oxygenLevel || "",
          payload?.sugar || "",
          payload?.thyroid || "",
          payload?.weight || "",
          payload?.temperature || "",
          payload?.pastHistoryCondition || "",
          payload?.pastHistory || "",
          toPaise(payload?.paymentAmount),
          payload?.notes || "",
          reportsJson,
          ts,
          ts
        ]
      );
      if (!insertedRow) return null;

      const postWriteTask = Promise.resolve()
        .then(async () => {
          await batch(db, [
            {
              sql: `INSERT INTO appointment_audit_log
                (clinic_id,patient_pk,appointment_id,action,event_at,appointment_created_at,appointment_updated_at)
                VALUES (?,?,?,?,?,?,?)`,
              params: [
                cid,
                pid,
                Number(insertedRow.id),
                "C",
                ts,
                Number(insertedRow.created_at || ts),
                Number(insertedRow.updated_at || ts)
              ]
            },
            {
              sql: `INSERT INTO clinic_minute_counters (clinic_id,action,bucket_start,count,created_at,updated_at)
                VALUES (?, 'appointment_add', ?, 1, ?, ?)
                ON CONFLICT(clinic_id, action, bucket_start)
                DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
              params: [cid, Math.floor(ts / 60000) * 60000, ts, ts]
            }
          ]);
          await refreshMedicalHistory(db, pid);
        })
        .catch((err) => {
          console.error("appointmentCreatePostWrite failed", err);
        });

      if (deferTask) {
        deferTask(postWriteTask);
      }

      return mapAppointment(insertedRow);
    },

    async listAppointments(clinicId, patientId, options = {}) {
      requireD1(db);
      const { limit, offset, cursorVisitAt, cursorAppointmentId } = normalizeLimitOffset(options, { defaultLimit: 20, maxLimit: 100 });
      const cid = Number(clinicId);
      const pid = Number(patientId);
      const patient = await one(db, "SELECT patient_pk FROM patients WHERE patient_pk=? AND clinic_id=?", [pid, cid]);
      if (!patient) return null;
      const rows = await many(
        db,
        `SELECT * FROM appointments
          WHERE clinic_id=? AND patient_pk=?
            AND (? IS NULL OR visit_at < ? OR (visit_at = ? AND id < ?))
          ORDER BY visit_at DESC, id DESC
          LIMIT ? OFFSET ?`,
        [cid, pid, cursorVisitAt, cursorVisitAt, cursorVisitAt, cursorAppointmentId, limit, offset]
      );
      return rows.map(mapAppointment);
    },

    async updateLatestAppointment(clinicId, patientId, appointmentId, payload, reports = []) {
      requireD1(db);
      const cid = Number(clinicId);
      const pid = Number(patientId);
      const aid = Number(appointmentId);

      const patient = await one(db, "SELECT patient_pk FROM patients WHERE patient_pk=? AND clinic_id=?", [pid, cid]);
      if (!patient) return { error: "patient_not_found" };

      const latest = await one(
        db,
        "SELECT * FROM appointments WHERE clinic_id=? AND patient_pk=? ORDER BY visit_at DESC, id DESC LIMIT 1",
        [cid, pid]
      );
      if (!latest) return { error: "appointment_not_found" };
      if (Number(latest.id) !== aid) return { error: "not_latest" };

      let mergedReports = [];
      try { mergedReports = JSON.parse(latest.reports_json || "[]"); } catch { mergedReports = []; }
      if (reports.length) {
        mergedReports = [
          ...mergedReports,
          ...reports.map((r) => ({
            id: `rep_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            name: r.name,
            url: r.url,
            mimeType: r.mimeType,
            size: r.size,
            uploadedAt: nowTs()
          }))
        ];
      }

      await run(
        db,
        `UPDATE appointments
           SET bp_systolic=?,bp_diastolic=?,pulse=?,oxygen_level=?,sugar=?,thyroid=?,weight=?,temperature=?,past_history_condition=?,past_history=?,payment_amount=?,notes=?,reports_json=?,updated_at=?
         WHERE id=? AND clinic_id=? AND patient_pk=?`,
        [
          payload?.bpSystolic ?? null,
          payload?.bpDiastolic ?? null,
          payload?.pulse || "",
          payload?.oxygenLevel || "",
          payload?.sugar || "",
          payload?.thyroid || "",
          payload?.weight || "",
          payload?.temperature || "",
          payload?.pastHistoryCondition || "",
          payload?.pastHistory || "",
          toPaise(payload?.paymentAmount),
          payload?.notes || "",
          JSON.stringify(mergedReports),
          nowTs(),
          aid,
          cid,
          pid
        ]
      );

      await refreshMedicalHistory(db, pid);
      const row = await one(db, "SELECT * FROM appointments WHERE id=? AND clinic_id=? AND patient_pk=?", [aid, cid, pid]);
      await logAppointmentAudit(db, "U", cid, pid, row);
      return { appointment: mapAppointment(row) };
    },

    async countPatientsAddedToday(clinicId) {
      requireD1(db);
      const { start, end } = getTodayRange();
      const row = await one(
        db,
        "SELECT COUNT(*) AS c FROM patients WHERE clinic_id=? AND created_at >= ? AND created_at <= ?",
        [Number(clinicId), start, end]
      );
      return Number(row?.c || 0);
    },

    async countAppointmentsAddedToday(clinicId) {
      requireD1(db);
      const { start, end } = getTodayRange();
      const row = await one(
        db,
        "SELECT COUNT(*) AS c FROM appointments WHERE clinic_id=? AND created_at >= ? AND created_at <= ?",
        [Number(clinicId), start, end]
      );
      return Number(row?.c || 0);
    },

    async getWeeklyPatientSummary(clinicId, weeks = 4) {
      requireD1(db);
      const total = Math.max(1, Math.min(Number(weeks) || 4, 12));
      const rows = await many(db, "SELECT patient_pk, visit_at FROM appointments WHERE clinic_id=?", [Number(clinicId)]);
      const visits = rows
        .map((r) => ({ patientId: Number(r.patient_pk), visitAt: new Date(Number(r.visit_at || 0)) }))
        .filter((r) => !Number.isNaN(r.visitAt.getTime()));
      const out = [];
      const currentStart = new Date();
      currentStart.setHours(0, 0, 0, 0);
      currentStart.setDate(currentStart.getDate() - ((currentStart.getDay() + 6) % 7));
      for (let i = total - 1; i >= 0; i -= 1) {
        const start = new Date(currentStart);
        start.setDate(start.getDate() - (i * 7));
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        const set = new Set();
        visits.forEach((v) => { if (v.visitAt >= start && v.visitAt <= end) set.add(v.patientId); });
        out.push({
          weekStart: start.toISOString().slice(0, 10),
          weekEnd: end.toISOString().slice(0, 10),
          patientCount: set.size
        });
      }
      return out;
    },

    async getMonthlyPatientSummary(clinicId, months = 6) {
      requireD1(db);
      const total = Math.max(1, Math.min(Number(months) || 6, 24));
      const rows = await many(db, "SELECT patient_pk, visit_at FROM appointments WHERE clinic_id=?", [Number(clinicId)]);
      const visits = rows
        .map((r) => ({ patientId: Number(r.patient_pk), visitAt: new Date(Number(r.visit_at || 0)) }))
        .filter((r) => !Number.isNaN(r.visitAt.getTime()));
      const today = new Date();
      const out = [];
      for (let i = total - 1; i >= 0; i -= 1) {
        const md = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const start = new Date(md.getFullYear(), md.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(md.getFullYear(), md.getMonth() + 1, 0, 23, 59, 59, 999);
        const set = new Set();
        visits.forEach((v) => { if (v.visitAt >= start && v.visitAt <= end) set.add(v.patientId); });
        out.push({
          month: `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, "0")}`,
          monthStart: start.toISOString().slice(0, 10),
          monthEnd: end.toISOString().slice(0, 10),
          patientCount: set.size
        });
      }
      return out;
    },

    async getNonRepeatPatients(clinicId) {
      requireD1(db);
      const rows = await many(
        db,
        `SELECT p.patient_pk,p.first_name,p.last_name,p.contact_number,p.gender,p.age_years,a.visit_at
         FROM patients p
         LEFT JOIN appointments a ON a.patient_pk=p.patient_pk AND a.clinic_id=p.clinic_id
         WHERE p.clinic_id=?
         ORDER BY a.visit_at DESC`,
        [Number(clinicId)]
      );
      const map = new Map();
      rows.forEach((r) => {
        const pid = Number(r.patient_pk);
        if (!map.has(pid)) {
          map.set(pid, {
            id: pid,
            firstName: r.first_name,
            lastName: r.last_name || "",
            phone: r.contact_number === null || r.contact_number === undefined ? "" : String(r.contact_number),
            ageYears: Number(r.age_years || 0),
            age: `${Number(r.age_years || 0)} year`,
            gender: fromGenderCode(r.gender),
            visits: []
          });
        }
        if (r.visit_at) map.get(pid).visits.push(Number(r.visit_at));
      });
      const out = [];
      map.forEach((p) => {
        if (p.visits.length === 1) out.push({ ...p, visitCount: 1, lastVisitAt: p.visits[0] });
      });
      return out.sort((a, b) => Number(b.lastVisitAt || 0) - Number(a.lastVisitAt || 0));
    },

    async getDataStoreDebugInfo() {
      requireD1(db);
      const clinics = Number((await one(db, "SELECT COUNT(*) AS c FROM clinics"))?.c || 0);
      const patients = Number((await one(db, "SELECT COUNT(*) AS c FROM patients"))?.c || 0);
      const appointments = Number((await one(db, "SELECT COUNT(*) AS c FROM appointments"))?.c || 0);
      return {
        dbFilePath: "cloudflare-d1",
        counts: { clinics, patients, appointments }
      };
    },

    async recordRequestMetric({
      requestId,
      route,
      clinicId,
      statusCode,
      latencyMs,
      createdAt = nowTs()
    }) {
      requireD1(db);
      const ts = Number(createdAt) || nowTs();
      const retentionMs = Math.max(
        60_000,
        Number(config?.requestLatencyRetentionHours || 48) * 60 * 60 * 1000
      );
      await run(
        db,
        `INSERT INTO request_latency_metrics
          (request_id, route, clinic_id, status_code, latency_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(requestId || "").slice(0, 64) || `${ts}`,
          String(route || "").slice(0, 120) || "unknown",
          Math.max(0, Number(clinicId) || 0),
          Math.max(0, Number(statusCode) || 0),
          Math.max(0, Number(latencyMs) || 0),
          ts
        ]
      );
      if (isWithinPurgeWindow(config, ts) && shouldRunLatencyPurge(config)) {
        await run(
          db,
          "DELETE FROM request_latency_metrics WHERE created_at <= ?",
          [ts - retentionMs]
        );
      }
    },

    async beginIdempotencyRequest({
      clinicId,
      scope,
      idempotencyKey,
      ttlMs = 24 * 60 * 60 * 1000,
      processingTtlMs = 60_000,
      now = nowTs()
    }) {
      requireD1(db);
      const cid = Number(clinicId || 0);
      const actionScope = String(scope || "").trim();
      const key = String(idempotencyKey || "").trim();
      if (!actionScope || !key) return { state: "processing" };
      const ts = Number(now) || nowTs();
      const exp = ts + Math.max(60_000, Number(ttlMs) || 0);
      const processingExp = ts + Math.max(1_000, Number(processingTtlMs) || 0);
      if (Math.random() < 0.02) {
        await run(
          db,
          "DELETE FROM idempotency_replays WHERE state='done' AND expires_at <= ?",
          [ts]
        );
      }

      const inserted = await run(
        db,
        `INSERT INTO idempotency_replays
          (clinic_id,scope,idempotency_key,status_code,response_json,state,processing_expires_at,created_at,updated_at,expires_at)
          VALUES (?,?,?,0,'{}','processing',?,?,?,?)
          ON CONFLICT(clinic_id, scope, idempotency_key) DO NOTHING`,
        [cid, actionScope, key, processingExp, ts, ts, exp]
      );
      if (Number(inserted?.meta?.changes || 0) > 0) {
        return { state: "started" };
      }

      const row = await one(
        db,
        `SELECT state, status_code, response_json, processing_expires_at, expires_at
          FROM idempotency_replays
          WHERE clinic_id=? AND scope=? AND idempotency_key=?
          LIMIT 1`,
        [cid, actionScope, key]
      );
      if (!row) return { state: "processing" };
      if (String(row.state || "done") === "done" && Number(row.expires_at || 0) > ts) {
        let body = {};
        try {
          body = JSON.parse(String(row.response_json || "{}"));
        } catch {
          body = {};
        }
        return {
          state: "replay",
          replay: {
            statusCode: Number(row.status_code || 200),
            body
          }
        };
      }
      if (String(row.state || "") === "processing" && Number(row.processing_expires_at || 0) > ts) {
        return { state: "processing" };
      }
      const claimed = await run(
        db,
        `UPDATE idempotency_replays
          SET state='processing',
              processing_expires_at=?,
              updated_at=?,
              expires_at=?
          WHERE clinic_id=? AND scope=? AND idempotency_key=?
            AND (
              expires_at <= ?
              OR (state='processing' AND COALESCE(processing_expires_at,0) <= ?)
            )`,
        [processingExp, ts, exp, cid, actionScope, key, ts, ts]
      );
      if (Number(claimed?.meta?.changes || 0) > 0) {
        return { state: "started" };
      }
      return { state: "processing" };
    },

    async finalizeIdempotencyRequest({
      clinicId,
      scope,
      idempotencyKey,
      statusCode,
      body,
      ttlMs = 24 * 60 * 60 * 1000,
      now = nowTs()
    }) {
      requireD1(db);
      const cid = Number(clinicId || 0);
      const actionScope = String(scope || "").trim();
      const key = String(idempotencyKey || "").trim();
      if (!actionScope || !key) return;
      const ts = Number(now) || nowTs();
      const exp = ts + Math.max(60_000, Number(ttlMs) || 0);
      await run(
        db,
        `UPDATE idempotency_replays
          SET state='done',
              status_code=?,
              response_json=?,
              processing_expires_at=NULL,
              updated_at=?,
              expires_at=?
          WHERE clinic_id=? AND scope=? AND idempotency_key=?`,
        [Number(statusCode || 200), JSON.stringify(body || {}), ts, exp, cid, actionScope, key]
      );
      if (Math.random() < 0.02) {
        await run(
          db,
          "DELETE FROM idempotency_replays WHERE state='done' AND expires_at <= ?",
          [ts]
        );
      }
    },

    async getIdempotencyReplay(clinicId, scope, idempotencyKey, now = nowTs()) {
      requireD1(db);
      const cid = Number(clinicId || 0);
      const actionScope = String(scope || "").trim();
      const key = String(idempotencyKey || "").trim();
      if (!actionScope || !key) return null;
      const row = await one(
        db,
        `SELECT status_code, response_json
          FROM idempotency_replays
          WHERE clinic_id=? AND scope=? AND idempotency_key=? AND state='done' AND expires_at > ?
          LIMIT 1`,
        [cid, actionScope, key, Number(now) || nowTs()]
      );
      if (!row) return null;
      let body = {};
      try {
        body = JSON.parse(String(row.response_json || "{}"));
      } catch {
        body = {};
      }
      return {
        statusCode: Number(row.status_code || 200),
        body
      };
    },

    async storeIdempotencyReplay({
      clinicId,
      scope,
      idempotencyKey,
      statusCode,
      body,
      ttlMs = 24 * 60 * 60 * 1000,
      now = nowTs()
    }) {
      await this.finalizeIdempotencyRequest({
        clinicId,
        scope,
        idempotencyKey,
        statusCode,
        body,
        ttlMs,
        now
      });
    }
  };
}

function createUnavailableRepository() {
  const unavailable = async () => {
    throw new Error("D1 repository is unavailable without a D1 binding.");
  };
  return {
    initDataStore: unavailable,
    findClinicByCode: unavailable,
    findClinicById: unavailable,
    verifyClinicPassword: unavailable,
    recordLoginSession: unavailable,
    recordLogoutSession: unavailable,
    touchSessionHeartbeat: unavailable,
    validateSession: unavailable,
    countClinicsRegisteredToday: unavailable,
    countPatientsAddedInLastMinute: unavailable,
    countAppointmentsAddedInLastMinute: unavailable,
    incrementPatientSearchCounter: unavailable,
    resetClinicPassword: unavailable,
    addClinic: unavailable,
    addPatient: unavailable,
    patientExistsForClinic: unavailable,
    searchPatients: unavailable,
    addAppointment: unavailable,
    listAppointments: unavailable,
    updateLatestAppointment: unavailable,
    countPatientsAddedToday: unavailable,
    countAppointmentsAddedToday: unavailable,
    getWeeklyPatientSummary: unavailable,
    getMonthlyPatientSummary: unavailable,
    getNonRepeatPatients: unavailable,
    getDataStoreDebugInfo: unavailable,
    recordRequestMetric: unavailable,
    beginIdempotencyRequest: unavailable,
    finalizeIdempotencyRequest: unavailable,
    getIdempotencyReplay: unavailable,
    storeIdempotencyReplay: unavailable
  };
}

export const d1Repository = createUnavailableRepository();
