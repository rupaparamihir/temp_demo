import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { hashPassword, verifyPassword } from "./password.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFilePath = path.resolve(__dirname, "../Test.db");
let db = null;

const nowTs = () => Date.now();
const digitsOnly = (v) => String(v || "").replace(/\D/g, "");
const toAmount = (value) => {
  const n = Number(String(value ?? "").trim().replace(/,/g, "").replace(/[−–]/g, "-"));
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
const parseTs = (value) => {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  const d = new Date(value).getTime();
  return Number.isFinite(d) && d > 0 ? d : nowTs();
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
const normalizeLimitOffset = (options = {}, defaults = {}) => {
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
};
const isWithinPurgeWindow = (now = nowTs()) => {
  const hour = new Date(now).getHours();
  const start = Number(config.requestLatencyPurgeStartHour ?? 2);
  const end = Number(config.requestLatencyPurgeEndHour ?? 5);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
};
const shouldRunLatencyPurge = () => {
  const pct = Math.max(1, Math.min(100, Number(config.requestLatencyPurgeSampleRatePercent) || 5));
  return Math.random() * 100 < pct;
};

function run(sql, params = {}) {
  return db.prepare(sql).run(normalizeParams(params));
}
function one(sql, params = {}) {
  return db.prepare(sql).get(normalizeParams(params)) || null;
}
function many(sql, params = {}) {
  return db.prepare(sql).all(normalizeParams(params));
}
function save() {}
function normalizeParams(params) {
  if (!params || Array.isArray(params)) return params;
  const out = { ...params };
  Object.entries(params).forEach(([key, value]) => {
    if (typeof key === "string" && /^[\$\:\@]/.test(key) && key.length > 1) {
      const plain = key.slice(1);
      if (!(plain in out)) out[plain] = value;
    }
  });
  return out;
}
function safeRun(sql, params = {}) {
  try {
    run(sql, params);
  } catch (_err) {
    // Skip optional DDL when legacy schema does not yet have target columns.
  }
}

function withWriteTransaction(work) {
  run("BEGIN IMMEDIATE");
  try {
    const result = work();
    run("COMMIT");
    return result;
  } catch (err) {
    try { run("ROLLBACK"); } catch {}
    throw err;
  }
}

function enqueueBackgroundTask(taskName, fn) {
  const runner = () => {
    try {
      fn();
    } catch (err) {
      console.error(`${taskName} failed`, err);
    }
  };
  if (typeof setImmediate === "function") {
    setImmediate(runner);
    return;
  }
  setTimeout(runner, 0);
}

function createSchema() {
  run(`CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, clinic_code TEXT NOT NULL UNIQUE,
    doctor_full_name TEXT NOT NULL, doctor_qualification TEXT NOT NULL, doctor_gender TEXT NOT NULL DEFAULT '',
    clinic_address TEXT NOT NULL, clinic_pincode INTEGER NOT NULL, clinic_city TEXT NOT NULL,
    clinic_state TEXT NOT NULL, contact_number TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
    consent_given INTEGER NOT NULL, password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS patients (
    patient_pk INTEGER PRIMARY KEY AUTOINCREMENT, clinic_id INTEGER NOT NULL, clinic_patient_id INTEGER NOT NULL,
    first_name TEXT NOT NULL, last_name TEXT, contact_number INTEGER, birth_year INTEGER NOT NULL, age_years INTEGER NOT NULL,
    gender TEXT, notes TEXT, consent_given TEXT NOT NULL DEFAULT 'N', medical_history TEXT NOT NULL DEFAULT 'NO',
    last_appointment_no INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id), UNIQUE (clinic_id, clinic_patient_id),
    CHECK (clinic_patient_id >= 1 AND clinic_patient_id <= 9999)
  )`);
  run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, clinic_id INTEGER NOT NULL, patient_pk INTEGER NOT NULL, appointment_number INTEGER NOT NULL,
    visit_at INTEGER NOT NULL, bp_systolic INTEGER, bp_diastolic INTEGER, pulse TEXT, oxygen_level TEXT,
    sugar TEXT, thyroid TEXT, weight TEXT, temperature TEXT, past_history_condition TEXT, past_history TEXT,
    payment_amount INTEGER NOT NULL DEFAULT 0, notes TEXT, reports_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (patient_pk) REFERENCES patients(patient_pk), FOREIGN KEY (clinic_id) REFERENCES clinics(id),
    UNIQUE (patient_pk, appointment_number)
  )`);
  run(`CREATE TABLE IF NOT EXISTS login_audit_sessions (
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
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id)
  )`);
  run(`CREATE TABLE IF NOT EXISTS appointment_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER NOT NULL,
    patient_pk INTEGER NOT NULL,
    appointment_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('C','U')),
    event_at INTEGER NOT NULL,
    appointment_created_at INTEGER NOT NULL,
    appointment_updated_at INTEGER NOT NULL,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id),
    FOREIGN KEY (patient_pk) REFERENCES patients(patient_pk),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  )`);
  run(`CREATE TABLE IF NOT EXISTS clinic_minute_counters (
    clinic_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    bucket_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (clinic_id, action, bucket_start)
  )`);
  run(`CREATE TABLE IF NOT EXISTS idempotency_replays (
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
  )`);
  run(`CREATE TABLE IF NOT EXISTS request_latency_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    route TEXT NOT NULL,
    clinic_id INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  run("CREATE INDEX IF NOT EXISTS idx_clinics_code ON clinics(clinic_code)");
  run("CREATE INDEX IF NOT EXISTS idx_clinics_contact ON clinics(contact_number)");
  run("CREATE INDEX IF NOT EXISTS idx_clinics_email ON clinics(email)");
  run("CREATE INDEX IF NOT EXISTS idx_clinics_updated ON clinics(updated_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_patients_clinic_name ON patients(clinic_id, first_name, last_name, patient_pk)");
  run("CREATE INDEX IF NOT EXISTS idx_patients_clinic_name_lc ON patients(clinic_id, lower(first_name), lower(last_name), patient_pk)");
  if (colType("patients", "contact_number")) {
    safeRun("CREATE INDEX IF NOT EXISTS idx_patients_clinic_contact ON patients(clinic_id, contact_number)");
  } else if (colType("patients", "phone")) {
    safeRun("CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone ON patients(clinic_id, phone)");
  }
  run("CREATE INDEX IF NOT EXISTS idx_patients_clinic_updated ON patients(clinic_id, updated_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_appointments_patient_visit ON appointments(patient_pk, visit_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_appointments_patient_updated ON appointments(patient_pk, updated_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_latest ON appointments(clinic_id, patient_pk, visit_at DESC, id DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_login_audit_clinic_time ON login_audit_sessions(clinic_id, login_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_login_audit_open ON login_audit_sessions(clinic_id, logout_at, login_at DESC)");
  if (colType("login_audit_sessions", "expires_at")) {
    safeRun("CREATE INDEX IF NOT EXISTS idx_login_audit_expires ON login_audit_sessions(expires_at, logout_at)");
  }
  run("CREATE INDEX IF NOT EXISTS idx_appointment_audit_clinic_time ON appointment_audit_log(clinic_id, event_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_clinic_minute_counters_bucket ON clinic_minute_counters(bucket_start)");
  run("CREATE INDEX IF NOT EXISTS idx_idempotency_replays_exp ON idempotency_replays(expires_at)");
  safeRun("CREATE INDEX IF NOT EXISTS idx_idempotency_replays_processing ON idempotency_replays(state, processing_expires_at)");
  run("CREATE INDEX IF NOT EXISTS idx_request_latency_metrics_created ON request_latency_metrics(created_at)");
}

function ensureLoginAuditColumns() {
  const hasTable = one("SELECT name FROM sqlite_master WHERE type='table' AND name='login_audit_sessions'");
  if (!hasTable) return;
  const hasLastSeen = colType("login_audit_sessions", "last_seen_at") === "INTEGER";
  const hasExpires = colType("login_audit_sessions", "expires_at") === "INTEGER";
  const hasEndReason = colType("login_audit_sessions", "end_reason") === "TEXT";
  if (!hasLastSeen) run("ALTER TABLE login_audit_sessions ADD COLUMN last_seen_at INTEGER");
  if (!hasExpires) run("ALTER TABLE login_audit_sessions ADD COLUMN expires_at INTEGER");
  if (!hasEndReason) run("ALTER TABLE login_audit_sessions ADD COLUMN end_reason TEXT");
  const now = nowTs();
  run(
    "UPDATE login_audit_sessions SET last_seen_at=COALESCE(last_seen_at, login_at, created_at, ?)",
    [now]
  );
  run(
    "UPDATE login_audit_sessions SET expires_at=COALESCE(expires_at, login_at + 28800000, created_at + 28800000, ?)",
    [now + 28800000]
  );
}

function ensureClinicColumns() {
  const hasTable = one("SELECT name FROM sqlite_master WHERE type='table' AND name='clinics'");
  if (!hasTable) return;
  const hasDoctorGender = colType("clinics", "doctor_gender") === "TEXT";
  if (!hasDoctorGender) {
    run("ALTER TABLE clinics ADD COLUMN doctor_gender TEXT NOT NULL DEFAULT ''");
  }
}

function ensurePatientAppointmentCounterColumn() {
  const hasTable = one("SELECT name FROM sqlite_master WHERE type='table' AND name='patients'");
  if (!hasTable) return;
  const hasCounter = colType("patients", "last_appointment_no") === "INTEGER";
  if (hasCounter) return;
  run("ALTER TABLE patients ADD COLUMN last_appointment_no INTEGER NOT NULL DEFAULT 0");
  run(`UPDATE patients
    SET last_appointment_no = COALESCE((
      SELECT MAX(a.appointment_number)
      FROM appointments a
      WHERE a.patient_pk = patients.patient_pk
    ), 0)`);
}

function ensureIdempotencyColumns() {
  const hasTable = one("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_replays'");
  if (!hasTable) return;
  if (!colType("idempotency_replays", "state")) {
    run("ALTER TABLE idempotency_replays ADD COLUMN state TEXT NOT NULL DEFAULT 'done'");
  }
  if (!colType("idempotency_replays", "processing_expires_at")) {
    run("ALTER TABLE idempotency_replays ADD COLUMN processing_expires_at INTEGER");
  }
  if (!colType("idempotency_replays", "updated_at")) {
    run("ALTER TABLE idempotency_replays ADD COLUMN updated_at INTEGER");
  }
  run("UPDATE idempotency_replays SET state=COALESCE(state,'done') WHERE state IS NULL OR state=''");
  run("UPDATE idempotency_replays SET updated_at=COALESCE(updated_at, created_at, ?)", [nowTs()]);
  run("CREATE INDEX IF NOT EXISTS idx_idempotency_replays_processing ON idempotency_replays(state, processing_expires_at)");
}

function ensureClinicAppointmentIndexes() {
  const clinicIdType = colType("appointments", "clinic_id");
  const hasClinicId = clinicIdType === "INTEGER" || clinicIdType === "TEXT";
  if (!hasClinicId) return;
  run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_visit ON appointments(clinic_id, visit_at DESC)");
  run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_updated ON appointments(clinic_id, updated_at DESC)");
  if (colType("appointments", "patient_pk")) {
    run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_visit ON appointments(clinic_id, patient_pk, visit_at DESC)");
    run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_latest ON appointments(clinic_id, patient_pk, visit_at DESC, id DESC)");
  } else {
    run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_visit ON appointments(clinic_id, patient_id, visit_at DESC)");
    run("CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_latest ON appointments(clinic_id, patient_id, visit_at DESC, id DESC)");
  }
}

function colType(table, col) {
  const info = many(`PRAGMA table_info(${table})`);
  const r = info.find((x) => String(x.name).toLowerCase() === col);
  return String(r?.type || "").toUpperCase();
}

function migrateLegacyIfNeeded() {
  const has = one("SELECT name FROM sqlite_master WHERE type='table' AND name='clinics'");
  if (!has) return;
  const hasLoginAudit = Boolean(one("SELECT name FROM sqlite_master WHERE type='table' AND name='login_audit_sessions'"));
  const hasAppointmentAudit = Boolean(one("SELECT name FROM sqlite_master WHERE type='table' AND name='appointment_audit_log'"));
  const hasMinuteCounters = Boolean(one("SELECT name FROM sqlite_master WHERE type='table' AND name='clinic_minute_counters'"));
  const oldClinicDoctorGenderExpr = colType("clinics", "doctor_gender")
    ? "CASE WHEN UPPER(TRIM(COALESCE(c0.doctor_gender,''))) IN ('MALE','M') THEN 'M' WHEN UPPER(TRIM(COALESCE(c0.doctor_gender,''))) IN ('FEMALE','F') THEN 'F' ELSE '' END"
    : "''";
  const oldPatientPkCol = colType("patients", "id") ? "p.id" : "p.patient_pk";
  const oldPatientClinicIdCol = colType("patients", "clinic_id") ? "p.clinic_id" : "p.clinicId";
  const oldPatientPhoneExpr = colType("patients", "phone")
    ? "CAST(REPLACE(REPLACE(REPLACE(COALESCE(CAST(p.phone AS TEXT),''),'-',''),' ',''),'+','') AS INTEGER)"
    : "CAST(COALESCE(p.contact_number, NULL) AS INTEGER)";
  const oldAppointmentPatientPkCol = colType("appointments", "patient_id") ? "a.patient_id" : "a.patient_pk";
  const oldAppointmentClinicIdCol = colType("appointments", "clinic_id") ? "a.clinic_id" : "NULL";
  const oldAuditPatientPkCol = hasAppointmentAudit
    ? (colType("appointment_audit_log", "patient_id") ? "a.patient_id" : "a.patient_pk")
    : "NULL";
  const needs = colType("clinics", "clinic_pincode") !== "INTEGER" ||
    colType("clinics", "id") !== "INTEGER" ||
    colType("clinics", "doctor_gender") !== "TEXT" ||
    colType("patients", "clinic_id") !== "INTEGER" ||
    colType("patients", "patient_pk") !== "INTEGER" ||
    colType("patients", "contact_number") !== "INTEGER" ||
    colType("patients", "consent_given") !== "TEXT" ||
    colType("clinics", "created_at") !== "INTEGER" ||
    colType("patients", "created_at") !== "INTEGER" ||
    colType("appointments", "clinic_id") !== "INTEGER" ||
    colType("appointments", "patient_pk") !== "INTEGER" ||
    colType("appointments", "visit_at") !== "INTEGER" ||
    colType("appointments", "payment_amount") !== "INTEGER" ||
    (hasLoginAudit && colType("login_audit_sessions", "clinic_id") !== "INTEGER") ||
    (hasAppointmentAudit && (colType("appointment_audit_log", "clinic_id") !== "INTEGER" || colType("appointment_audit_log", "patient_pk") !== "INTEGER")) ||
    (hasMinuteCounters && colType("clinic_minute_counters", "clinic_id") !== "INTEGER");
  if (!needs) return;

  run("BEGIN TRANSACTION");
  try {
    run("ALTER TABLE clinics RENAME TO clinics_old");
    run("ALTER TABLE patients RENAME TO patients_old");
    run("ALTER TABLE appointments RENAME TO appointments_old");
    if (hasLoginAudit) run("ALTER TABLE login_audit_sessions RENAME TO login_audit_sessions_old");
    if (hasAppointmentAudit) run("ALTER TABLE appointment_audit_log RENAME TO appointment_audit_log_old");
    if (hasMinuteCounters) run("ALTER TABLE clinic_minute_counters RENAME TO clinic_minute_counters_old");
    createSchema();

    run(`INSERT INTO clinics
      (name,clinic_code,doctor_full_name,doctor_qualification,doctor_gender,clinic_address,clinic_pincode,clinic_city,clinic_state,contact_number,email,consent_given,password_hash,created_at,updated_at)
      SELECT c0.name,c0.clinic_code,c0.doctor_full_name,c0.doctor_qualification,${oldClinicDoctorGenderExpr},c0.clinic_address,
      CAST(REPLACE(REPLACE(REPLACE(COALESCE(clinic_pincode,''),' ',''),'-',''),'+','') AS INTEGER),
      c0.clinic_city,c0.clinic_state,c0.contact_number,c0.email,c0.consent_given,c0.password_hash,
      CASE WHEN typeof(c0.created_at)='text' THEN CAST(strftime('%s',c0.created_at)*1000 AS INTEGER) ELSE CAST(c0.created_at AS INTEGER) END,
      CASE WHEN typeof(c0.updated_at)='text' THEN CAST(strftime('%s',c0.updated_at)*1000 AS INTEGER) ELSE CAST(c0.updated_at AS INTEGER) END
      FROM clinics_old c0`);

    run(`INSERT INTO patients
      (patient_pk,clinic_id,clinic_patient_id,first_name,last_name,contact_number,birth_year,age_years,gender,notes,consent_given,medical_history,last_appointment_no,created_at,updated_at)
      SELECT ${oldPatientPkCol},c.id,p.clinic_patient_id,p.first_name,p.last_name,
      CASE
        WHEN TRIM(COALESCE(CAST(${oldPatientPhoneExpr} AS TEXT),''))='' THEN NULL
        ELSE ${oldPatientPhoneExpr}
      END,
      p.birth_year,p.age_years,
      CASE
        WHEN UPPER(TRIM(COALESCE(p.gender,''))) IN ('MALE','M') THEN 'M'
        WHEN UPPER(TRIM(COALESCE(p.gender,''))) IN ('FEMALE','F') THEN 'F'
        ELSE ''
      END,
      p.notes,
      CASE
        WHEN UPPER(TRIM(CAST(COALESCE(p.consent_given,'') AS TEXT))) IN ('1','Y','TRUE') THEN 'Y'
        ELSE 'N'
      END,
      p.medical_history,
      0,
      CASE WHEN typeof(p.created_at)='text' THEN CAST(strftime('%s',p.created_at)*1000 AS INTEGER) ELSE CAST(p.created_at AS INTEGER) END,
      CASE WHEN typeof(p.updated_at)='text' THEN CAST(strftime('%s',p.updated_at)*1000 AS INTEGER) ELSE CAST(p.updated_at AS INTEGER) END
      FROM patients_old p
      JOIN clinics_old co ON CAST(co.id AS TEXT) = CAST(${oldPatientClinicIdCol} AS TEXT)
      JOIN clinics c ON c.contact_number = co.contact_number`);

    run(`INSERT INTO appointments
      (id,clinic_id,patient_pk,appointment_number,visit_at,bp_systolic,bp_diastolic,pulse,oxygen_level,sugar,thyroid,weight,temperature,past_history_condition,past_history,payment_amount,notes,reports_json,created_at,updated_at)
      SELECT a.id,c.id,${oldAppointmentPatientPkCol},a.appointment_number,
      CASE WHEN typeof(visit_at)='text' THEN CAST(strftime('%s',visit_at)*1000 AS INTEGER) ELSE CAST(visit_at AS INTEGER) END,
      a.bp_systolic,a.bp_diastolic,a.pulse,a.oxygen_level,a.sugar,a.thyroid,a.weight,a.temperature,a.past_history_condition,a.past_history,
      CAST(ROUND(CAST(a.payment_amount AS REAL) * 100) AS INTEGER),
      a.notes,COALESCE(a.reports_json,'[]'),
      CASE WHEN typeof(a.created_at)='text' THEN CAST(strftime('%s',a.created_at)*1000 AS INTEGER) ELSE CAST(a.created_at AS INTEGER) END,
      CASE WHEN typeof(a.updated_at)='text' THEN CAST(strftime('%s',a.updated_at)*1000 AS INTEGER) ELSE CAST(a.updated_at AS INTEGER) END
      FROM appointments_old a
      JOIN patients_old p ON ${oldPatientPkCol} = ${oldAppointmentPatientPkCol}
      JOIN clinics_old co ON CAST(co.id AS TEXT) = CAST(COALESCE(${oldAppointmentClinicIdCol}, ${oldPatientClinicIdCol}) AS TEXT)
      JOIN clinics c ON c.contact_number = co.contact_number`);

    if (hasLoginAudit) {
      run(`INSERT INTO login_audit_sessions
        (clinic_id,session_id,ip_address,login_at,last_seen_at,expires_at,logout_at,end_reason,created_at,updated_at)
        SELECT c.id,l.session_id,l.ip_address,
          COALESCE(l.login_at, l.created_at, CAST(strftime('%s','now')*1000 AS INTEGER)),
          COALESCE(l.last_seen_at, l.login_at, l.created_at, CAST(strftime('%s','now')*1000 AS INTEGER)),
          COALESCE(l.expires_at, l.login_at + 28800000, l.created_at + 28800000, CAST(strftime('%s','now')*1000 AS INTEGER) + 28800000),
          l.logout_at,l.end_reason,
          COALESCE(l.created_at, CAST(strftime('%s','now')*1000 AS INTEGER)),
          COALESCE(l.updated_at, CAST(strftime('%s','now')*1000 AS INTEGER))
        FROM login_audit_sessions_old l
        JOIN clinics_old co ON CAST(co.id AS TEXT) = CAST(l.clinic_id AS TEXT)
        JOIN clinics c ON c.contact_number = co.contact_number`);
    }

    if (hasAppointmentAudit) {
      run(`INSERT INTO appointment_audit_log
        (clinic_id,patient_pk,appointment_id,action,event_at,appointment_created_at,appointment_updated_at)
        SELECT c.id,${oldAuditPatientPkCol},a.appointment_id,a.action,a.event_at,a.appointment_created_at,a.appointment_updated_at
        FROM appointment_audit_log_old a
        JOIN clinics_old co ON CAST(co.id AS TEXT) = CAST(a.clinic_id AS TEXT)
        JOIN clinics c ON c.contact_number = co.contact_number`);
    }

    if (hasMinuteCounters) {
      run(`INSERT INTO clinic_minute_counters
        (clinic_id,action,bucket_start,count,created_at,updated_at)
        SELECT c.id,m.action,m.bucket_start,m.count,m.created_at,m.updated_at
        FROM clinic_minute_counters_old m
        JOIN clinics_old co ON CAST(co.id AS TEXT) = CAST(m.clinic_id AS TEXT)
        JOIN clinics c ON c.contact_number = co.contact_number`);
    }

    run("DROP TABLE clinics_old");
    run("DROP TABLE patients_old");
    run("DROP TABLE appointments_old");
    if (hasLoginAudit) run("DROP TABLE login_audit_sessions_old");
    if (hasAppointmentAudit) run("DROP TABLE appointment_audit_log_old");
    if (hasMinuteCounters) run("DROP TABLE clinic_minute_counters_old");
    run("COMMIT");
  } catch (e) {
    run("ROLLBACK");
    throw e;
  }
}

function parseHistory(value = "") {
  return String(value || "").split(",").map((x) => x.trim()).filter((x) => x && x.toUpperCase() !== "NO");
}

function refreshMedicalHistory(patientId) {
  const rows = many("SELECT past_history_condition FROM appointments WHERE patient_pk=$id", { $id: patientId });
  const set = new Set();
  rows.forEach((r) => parseHistory(r.past_history_condition || "").forEach((x) => set.add(x)));
  const value = set.size ? Array.from(set).join(", ") : "NO";
  run("UPDATE patients SET medical_history=$m, updated_at=$u WHERE patient_pk=$id", { $m: value, $u: nowTs(), $id: patientId });
}

const mapClinic = (r) => r ? ({
  id: r.id, name: r.name, clinicCode: r.clinic_code, doctorFullName: r.doctor_full_name, doctorQualification: r.doctor_qualification, doctorGender: fromGenderCode(r.doctor_gender),
  clinicAddress: r.clinic_address, clinicPincode: String(r.clinic_pincode || ""), clinicCity: r.clinic_city, clinicState: r.clinic_state,
  contactNumber: r.contact_number, email: r.email, consentGiven: Boolean(r.consent_given), passwordHash: r.password_hash,
  createdAt: Number(r.created_at || 0), updatedAt: Number(r.updated_at || 0)
}) : null;

const mapPatient = (r) => r ? ({
  id: r.patient_pk, clinicId: r.clinic_id, clinicPatientId: r.clinic_patient_id, firstName: r.first_name, lastName: r.last_name || "",
  phone: r.contact_number === null || r.contact_number === undefined ? "" : String(r.contact_number), birthYear: String(r.birth_year || ""), ageYears: Number(r.age_years || 0), age: `${Number(r.age_years || 0)} year`,
  gender: fromGenderCode(r.gender), notes: r.notes || "", consentGiven: fromConsentFlag(r.consent_given), medicalHistory: r.medical_history || "NO",
  createdAt: Number(r.created_at || 0), updatedAt: Number(r.updated_at || 0)
}) : null;

function mapAppointment(r) {
  if (!r) return null;
  let reports = [];
  try { reports = JSON.parse(r.reports_json || "[]"); } catch { reports = []; }
  return {
    id: r.id, appointmentNumber: r.appointment_number, visitAt: Number(r.visit_at || 0), bpSystolic: r.bp_systolic === null ? null : Number(r.bp_systolic),
    bpDiastolic: r.bp_diastolic === null ? null : Number(r.bp_diastolic), pulse: r.pulse || "", oxygenLevel: r.oxygen_level || "",
    sugar: r.sugar || "", thyroid: r.thyroid || "", weight: r.weight || "", temperature: r.temperature || "",
    pastHistoryCondition: r.past_history_condition || "", pastHistory: r.past_history || "", paymentAmount: fromPaise(r.payment_amount),
    notes: r.notes || "", reports, createdAt: Number(r.created_at || 0), updatedAt: Number(r.updated_at || 0)
  };
}

function logAppointmentAudit(action, clinicId, patientId, appointmentRow) {
  if (!appointmentRow) return;
  const now = nowTs();
  run(
    `INSERT INTO appointment_audit_log
      (clinic_id,patient_pk,appointment_id,action,event_at,appointment_created_at,appointment_updated_at)
      VALUES ($clinic,$patient,$appointment,$action,$eventAt,$createdAt,$updatedAt)`,
    {
      $clinic: clinicId,
      $patient: Number(patientId),
      $appointment: Number(appointmentRow.id),
      $action: action,
      $eventAt: now,
      $createdAt: Number(appointmentRow.created_at || now),
      $updatedAt: Number(appointmentRow.updated_at || now)
    }
  );
}

export async function initDataStore() {
  if (db) db.close();
  db = new Database(dbFilePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  createSchema();
  ensureClinicColumns();
  ensurePatientAppointmentCounterColumn();
  ensureIdempotencyColumns();
  ensureLoginAuditColumns();
  migrateLegacyIfNeeded();
  createSchema();
  ensureClinicColumns();
  ensurePatientAppointmentCounterColumn();
  ensureIdempotencyColumns();
  ensureLoginAuditColumns();
  ensureClinicAppointmentIndexes();
  save();
}

export async function findClinicByCode(clinicCode) {
  const value = String(clinicCode || "").trim();
  if (!value) return null;
  const row = one(`SELECT * FROM clinics WHERE clinic_code=$v OR contact_number=$v OR contact_number=$d LIMIT 1`, { $v: value, $d: digitsOnly(value) });
  return mapClinic(row);
}

export async function findClinicById(clinicId) {
  const value = String(clinicId || "").trim();
  if (!value) return null;
  const row = one("SELECT * FROM clinics WHERE id=$id LIMIT 1", { $id: value });
  return mapClinic(row);
}

export async function verifyClinicPassword(clinic, password) {
  return verifyPassword(String(password || ""), clinic.passwordHash);
}

export async function recordLoginSession({ clinicId, sessionId, ipAddress, loginAt = nowTs(), expiresAt = null }) {
  const ts = Number(loginAt) || nowTs();
  const exp = Number(expiresAt) || (ts + 8 * 60 * 60 * 1000);
  run(
    `INSERT INTO login_audit_sessions (clinic_id,session_id,ip_address,login_at,last_seen_at,expires_at,logout_at,end_reason,created_at,updated_at)
      VALUES ($clinic,$session,$ip,$login,$lastSeen,$expires,NULL,NULL,$created,$updated)`,
    {
      $clinic: String(clinicId || "").trim(),
      $session: String(sessionId || "").trim(),
      $ip: String(ipAddress || "unknown").slice(0, 45),
      $login: ts,
      $lastSeen: ts,
      $expires: exp,
      $created: ts,
      $updated: ts
    }
  );
  save();
}

export async function recordLogoutSession(clinicId, sessionId, logoutAt = nowTs(), ipAddress = "") {
  const ts = Number(logoutAt) || nowTs();
  const clinic = String(clinicId || "").trim();
  const session = String(sessionId || "").trim();
  if (!clinic) return false;

  if (session) {
    const result = run(
      `UPDATE login_audit_sessions
        SET logout_at=$logout, end_reason='explicit', updated_at=$updated
        WHERE clinic_id=$clinic AND session_id=$session AND logout_at IS NULL`,
      {
        $clinic: clinic,
        $session: session,
        $logout: ts,
        $updated: ts
      }
    );
    if (Number(result?.changes || 0) > 0) {
      save();
      return true;
    }
  }

  const ip = String(ipAddress || "").trim();
  const fallback = run(
    `UPDATE login_audit_sessions
      SET logout_at=$logout, end_reason='explicit', updated_at=$updated
      WHERE id = (
        SELECT id FROM login_audit_sessions
        WHERE clinic_id=$clinic
          AND logout_at IS NULL
          AND ($ip='' OR ip_address=$ip)
        ORDER BY login_at DESC
        LIMIT 1
      )`,
    {
      $clinic: clinic,
      $ip: ip,
      $logout: ts,
      $updated: ts
    }
  );
  const changed = Number(fallback?.changes || 0) > 0;
  if (changed) save();
  return changed;
}

export async function touchSessionHeartbeat(clinicId, sessionId, seenAt = nowTs()) {
  const clinic = String(clinicId || "").trim();
  const session = String(sessionId || "").trim();
  if (!clinic || !session) return false;
  const ts = Number(seenAt) || nowTs();
  const result = run(
    `UPDATE login_audit_sessions
      SET last_seen_at=$seen, updated_at=$updated
      WHERE clinic_id=$clinic AND session_id=$session AND logout_at IS NULL`,
    {
      $clinic: clinic,
      $session: session,
      $seen: ts,
      $updated: ts
    }
  );
  const changed = Number(result?.changes || 0) > 0;
  if (changed) save();
  return changed;
}

export async function validateSession(clinicId, sessionId, now = nowTs()) {
  const clinic = String(clinicId || "").trim();
  const session = String(sessionId || "").trim();
  if (!clinic || !session) return false;
  const row = one(
    `SELECT id FROM login_audit_sessions
      WHERE clinic_id=$clinic
        AND session_id=$session
        AND logout_at IS NULL
        AND (expires_at IS NULL OR expires_at > $now)
      LIMIT 1`,
    {
      $clinic: clinic,
      $session: session,
      $now: Number(now) || nowTs()
    }
  );
  return Boolean(row?.id);
}

export async function countClinicsRegisteredToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const row = one(
    "SELECT COUNT(*) AS c FROM clinics WHERE created_at >= $start AND created_at <= $end",
    { $start: start.getTime(), $end: end.getTime() }
  );
  return Number(row?.count || 0);
}

export async function countPatientsAddedInLastMinute(clinicId, now = nowTs()) {
  const ts = Number(now) || nowTs();
  const bucket = Math.floor(ts / 60000) * 60000;
  const row = one(
    "SELECT count FROM clinic_minute_counters WHERE clinic_id=$clinic AND action='patient_add' AND bucket_start=$bucket",
    { $clinic: String(clinicId || "").trim(), $bucket: bucket }
  );
  return Number(row?.count || 0);
}

export async function countAppointmentsAddedInLastMinute(clinicId, now = nowTs()) {
  const ts = Number(now) || nowTs();
  const bucket = Math.floor(ts / 60000) * 60000;
  const row = one(
    "SELECT count FROM clinic_minute_counters WHERE clinic_id=$clinic AND action='appointment_add' AND bucket_start=$bucket",
    { $clinic: String(clinicId || "").trim(), $bucket: bucket }
  );
  return Number(row?.c || 0);
}

function incrementClinicMinuteCounter(clinicId, action, now = nowTs(), readBack = true) {
  const ts = Number(now) || nowTs();
  const bucket = Math.floor(ts / 60000) * 60000;
  const cid = String(clinicId || "").trim();
  run(
    `INSERT INTO clinic_minute_counters (clinic_id,action,bucket_start,count,created_at,updated_at)
      VALUES ($clinic,$action,$bucket,1,$created,$updated)
      ON CONFLICT(clinic_id, action, bucket_start)
      DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
    {
      $clinic: cid,
      $action: String(action || "").trim(),
      $bucket: bucket,
      $created: ts,
      $updated: ts
    }
  );
  if (Math.random() < 0.01) {
    run("DELETE FROM clinic_minute_counters WHERE bucket_start < $cutoff", { $cutoff: ts - 48 * 60 * 60 * 1000 });
  }
  if (!readBack) {
    save();
    return null;
  }
  const row = one(
    "SELECT count FROM clinic_minute_counters WHERE clinic_id=$clinic AND action=$action AND bucket_start=$bucket",
    { $clinic: cid, $action: String(action || "").trim(), $bucket: bucket }
  );
  save();
  return Number(row?.count || 0);
}

export async function incrementPatientSearchCounter(clinicId, now = nowTs()) {
  return incrementClinicMinuteCounter(clinicId, "patient_search", now);
}

export async function resetClinicPassword(contactNumber, email, newPassword) {
  const row = one("SELECT id FROM clinics WHERE contact_number=$c AND LOWER(email)=$e LIMIT 1", { $c: digitsOnly(contactNumber), $e: String(email || "").trim().toLowerCase() });
  if (!row) return false;
  const hash = await hashPassword(String(newPassword || ""), config.passwordPbkdf2Iterations);
  run("UPDATE clinics SET password_hash=$h, updated_at=$u WHERE id=$id", {
    $h: hash,
    $u: nowTs(),
    $id: row.id
  });
  save();
  return true;
}

export async function addClinic(payload) {
  const contactNumber = digitsOnly(payload.clinicContactNumber);
  const clinicEmail = String(payload.clinicEmailId || "").trim().toLowerCase();
  const hash = await hashPassword(String(payload.loginPassword || ""), config.passwordPbkdf2Iterations);
  const clinic = withWriteTransaction(() => {
    if (one("SELECT id FROM clinics WHERE contact_number=$c LIMIT 1", { $c: contactNumber })) throw new Error("Clinic contact number is already registered");
    if (one("SELECT id FROM clinics WHERE LOWER(email)=$e LIMIT 1", { $e: clinicEmail })) throw new Error("Clinic email id is already registered");
    const now = nowTs();
    run(`INSERT INTO clinics (name,clinic_code,doctor_full_name,doctor_qualification,doctor_gender,clinic_address,clinic_pincode,clinic_city,clinic_state,contact_number,email,consent_given,password_hash,created_at,updated_at)
      VALUES ($name,$code,$doc,$q,$dg,$addr,$pin,$city,$state,$contact,$email,$consent,$hash,$c,$u)`, {
      $name: String(payload.clinicName || "").trim(), $code: contactNumber, $doc: String(payload.doctorFullName || "").trim(),
      $q: String(payload.doctorQualification || "").trim(), $dg: toGenderCode(payload.doctorGender), $addr: String(payload.clinicAddress || "").trim(),
      $pin: Number(String(payload.clinicPincode || "").replace(/\D/g, "")) || 0, $city: String(payload.clinicCity || "").trim(),
      $state: String(payload.clinicState || "").trim(), $contact: contactNumber, $email: clinicEmail, $consent: payload.consentGiven ? 1 : 0,
      $hash: hash, $c: now, $u: now
    });
    return one("SELECT * FROM clinics WHERE id=last_insert_rowid()");
  });
  save();
  return mapClinic(clinic);
}

export async function addPatient(clinicId, payload) {
  const row = withWriteTransaction(() => {
    const next = one("SELECT COALESCE(MAX(clinic_patient_id),0)+1 AS n FROM patients WHERE clinic_id=$id", { $id: clinicId });
    const clinicPatientId = Number(next?.n || 1);
    if (clinicPatientId > 9999) throw new Error("Clinic patient id limit reached (max 9999)");
    const now = nowTs();
    run(`INSERT INTO patients (clinic_id,clinic_patient_id,first_name,last_name,contact_number,birth_year,age_years,gender,notes,consent_given,medical_history,created_at,updated_at)
      VALUES ($clinic,$cpid,$fn,$ln,$contact,$by,$ay,$g,$n,$consent,'NO',$c,$u)`, {
      $clinic: clinicId, $cpid: clinicPatientId, $fn: String(payload.firstName || "").trim(), $ln: String(payload.lastName || "").trim(), $contact: toPatientContactNumber(payload.phone || payload.contactNumber),
      $by: Number(payload.birthYear), $ay: Number(payload.ageYears), $g: toGenderCode(payload.gender), $n: String(payload.notes || ""), $consent: toConsentFlag(payload.consentGiven), $c: now, $u: now
    });
    const inserted = one("SELECT * FROM patients WHERE patient_pk=last_insert_rowid()");
    incrementClinicMinuteCounter(clinicId, "patient_add", now, false);
    return inserted;
  });
  save();
  return mapPatient(row);
}

export async function patientExistsForClinic(clinicId, firstName, lastName = "", birthYear = "", phone = "", gender = "") {
  const rows = many(`SELECT contact_number FROM patients WHERE clinic_id=$clinic AND LOWER(first_name)=$fn AND LOWER(COALESCE(last_name,''))=$ln AND CAST(birth_year AS TEXT)=$by AND UPPER(COALESCE(gender,''))=$g`, {
    $clinic: clinicId, $fn: String(firstName || "").trim().toLowerCase(), $ln: String(lastName || "").trim().toLowerCase(), $by: String(birthYear || "").trim(), $g: toGenderCode(gender)
  });
  if (!rows.length) return false;
  const p = digitsOnly(phone);
  return rows.some((r) => digitsOnly(String(r.contact_number || "")) === p);
}

export async function searchPatients(clinicId, firstName = "", lastName = "", phone = "", options = {}) {
  const { limit, offset, cursorUpdatedAt, cursorPatientPk } = normalizeLimitOffset(options, { defaultLimit: 20, maxLimit: 100 });
  const firstNameValue = String(firstName || "").trim().toLowerCase();
  const lastNameValue = String(lastName || "").trim().toLowerCase();
  const phoneDigits = digitsOnly(phone);
  const phoneRange = buildPhoneRange(phoneDigits);
  const rows = many(`SELECT * FROM patients
    WHERE clinic_id=$clinic
      AND ($fn='' OR LOWER(first_name) LIKE $fnPrefix)
      AND ($ln='' OR LOWER(COALESCE(last_name,'')) LIKE $lnPrefix)
      AND ($ph='' OR ($phLow IS NOT NULL AND contact_number >= $phLow AND contact_number <= $phHigh))
      AND (
        $cursorUpdatedAt IS NULL
        OR updated_at < $cursorUpdatedAt
        OR (updated_at = $cursorUpdatedAt AND patient_pk < $cursorPatientPk)
      )
    ORDER BY updated_at DESC, patient_pk DESC
    LIMIT $limit OFFSET $offset`, {
    $clinic: clinicId,
    $fn: firstNameValue,
    $fnPrefix: firstNameValue ? `${firstNameValue}%` : "",
    $ln: lastNameValue,
    $lnPrefix: lastNameValue ? `${lastNameValue}%` : "",
    $ph: phoneDigits,
    $phLow: phoneRange ? phoneRange.low : null,
    $phHigh: phoneRange ? phoneRange.high : null,
    $cursorUpdatedAt: cursorUpdatedAt,
    $cursorPatientPk: cursorPatientPk,
    $limit: limit,
    $offset: offset
  });
  return rows.map(mapPatient);
}

export async function addAppointment(clinicId, patientId, payload, reports = []) {
  const row = withWriteTransaction(() => {
    const patient = one("SELECT * FROM patients WHERE patient_pk=$id AND clinic_id=$clinic", { $id: patientId, $clinic: clinicId });
    if (!patient) return null;
    run(
      `UPDATE patients
        SET last_appointment_no = COALESCE(last_appointment_no, 0) + 1
        WHERE patient_pk=$id AND clinic_id=$clinic`,
      { $id: patientId, $clinic: clinicId }
    );
    const next = one(
      "SELECT last_appointment_no AS n FROM patients WHERE patient_pk=$id AND clinic_id=$clinic",
      { $id: patientId, $clinic: clinicId }
    );
    const now = nowTs();
    const apptNo = Number(next?.n || 1);
    const reportsJson = JSON.stringify((reports || []).map((r) => ({ id: `rep_${Date.now()}_${Math.floor(Math.random() * 10000)}`, name: r.name, url: r.url, mimeType: r.mimeType, size: r.size, uploadedAt: nowTs() })));
    run(`INSERT INTO appointments (clinic_id,patient_pk,appointment_number,visit_at,bp_systolic,bp_diastolic,pulse,oxygen_level,sugar,thyroid,weight,temperature,past_history_condition,past_history,payment_amount,notes,reports_json,created_at,updated_at)
      VALUES ($clinic,$pid,$n,$v,$bps,$bpd,$pulse,$o2,$sugar,$thy,$wt,$tmp,$phc,$ph,$pay,$notes,$rep,$c,$u)`, {
      $clinic: clinicId, $pid: patientId, $n: apptNo, $v: now, $bps: payload.bpSystolic, $bpd: payload.bpDiastolic, $pulse: payload.pulse || "", $o2: payload.oxygenLevel || "", $sugar: payload.sugar || "",
      $thy: payload.thyroid || "", $wt: payload.weight || "", $tmp: payload.temperature || "", $phc: payload.pastHistoryCondition || "", $ph: payload.pastHistory || "",
      $pay: toPaise(payload.paymentAmount), $notes: payload.notes || "", $rep: reportsJson, $c: now, $u: now
    });
    return one("SELECT * FROM appointments WHERE id=last_insert_rowid()");
  });
  if (!row) return null;
  enqueueBackgroundTask("appointmentCreatePostWrite", () => {
    logAppointmentAudit("C", clinicId, patientId, row);
    incrementClinicMinuteCounter(clinicId, "appointment_add", Number(row.created_at || nowTs()), false);
    refreshMedicalHistory(patientId);
  });
  save();
  return mapAppointment(row);
}

export async function listAppointments(clinicId, patientId, options = {}) {
  const { limit, offset, cursorVisitAt, cursorAppointmentId } = normalizeLimitOffset(options, { defaultLimit: 20, maxLimit: 100 });
  if (!one("SELECT patient_pk FROM patients WHERE patient_pk=$id AND clinic_id=$clinic", { $id: patientId, $clinic: clinicId })) return null;
  return many(
    `SELECT * FROM appointments
      WHERE clinic_id=$clinic
        AND patient_pk=$id
        AND (
          $cursorVisitAt IS NULL
          OR visit_at < $cursorVisitAt
          OR (visit_at = $cursorVisitAt AND id < $cursorAppointmentId)
        )
      ORDER BY visit_at DESC, id DESC
      LIMIT $limit OFFSET $offset`,
    {
      $clinic: clinicId,
      $id: patientId,
      $cursorVisitAt: cursorVisitAt,
      $cursorAppointmentId: cursorAppointmentId,
      $limit: limit,
      $offset: offset
    }
  ).map(mapAppointment);
}

export async function updateLatestAppointment(clinicId, patientId, appointmentId, payload, reports = []) {
  const result = withWriteTransaction(() => {
    if (!one("SELECT patient_pk FROM patients WHERE patient_pk=$id AND clinic_id=$clinic", { $id: patientId, $clinic: clinicId })) {
      return { error: "patient_not_found" };
    }
    const latest = one(
      "SELECT * FROM appointments WHERE clinic_id=$clinic AND patient_pk=$id ORDER BY visit_at DESC, id DESC LIMIT 1",
      { $clinic: clinicId, $id: patientId }
    );
    if (!latest) return { error: "appointment_not_found" };
    if (Number(latest.id) !== Number(appointmentId)) return { error: "not_latest" };

    let rep = [];
    try { rep = JSON.parse(latest.reports_json || "[]"); } catch { rep = []; }
    if (reports.length) {
      rep = [
        ...rep,
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
    const ts = nowTs();
    run(`UPDATE appointments SET bp_systolic=$bps,bp_diastolic=$bpd,pulse=$pulse,oxygen_level=$o2,sugar=$sugar,thyroid=$thy,weight=$wt,temperature=$tmp,past_history_condition=$phc,past_history=$ph,payment_amount=$pay,notes=$notes,reports_json=$rep,updated_at=$u WHERE id=$id AND clinic_id=$clinic AND patient_pk=$pid`, {
      $id: Number(appointmentId), $clinic: clinicId, $pid: Number(patientId), $bps: payload.bpSystolic, $bpd: payload.bpDiastolic, $pulse: payload.pulse || "", $o2: payload.oxygenLevel || "", $sugar: payload.sugar || "",
      $thy: payload.thyroid || "", $wt: payload.weight || "", $tmp: payload.temperature || "", $phc: payload.pastHistoryCondition || "", $ph: payload.pastHistory || "",
      $pay: toPaise(payload.paymentAmount), $notes: payload.notes || "", $rep: JSON.stringify(rep), $u: ts
    });
    refreshMedicalHistory(patientId);
    const row = one("SELECT * FROM appointments WHERE id=$id AND clinic_id=$clinic AND patient_pk=$pid", {
      $id: Number(appointmentId),
      $clinic: clinicId,
      $pid: Number(patientId)
    });
    logAppointmentAudit("U", clinicId, patientId, row);
    incrementClinicMinuteCounter(clinicId, "appointment_update", ts, false);
    return { appointment: mapAppointment(row) };
  });
  if (result?.error) return result;
  save();
  return result;
}

function isWithinToday(tsLike) {
  const t = parseTs(tsLike);
  const d = new Date(t);
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  return d >= s && d <= e;
}

export async function countPatientsAddedToday(clinicId) {
  return many("SELECT created_at FROM patients WHERE clinic_id=$id", { $id: clinicId }).filter((r) => isWithinToday(r.created_at)).length;
}

export async function countAppointmentsAddedToday(clinicId) {
  return many("SELECT created_at FROM appointments WHERE clinic_id=$id", { $id: clinicId }).filter((r) => isWithinToday(r.created_at)).length;
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function weekStartMon(d) { const c = new Date(d); c.setHours(0, 0, 0, 0); const day = c.getDay(); c.setDate(c.getDate() - ((day + 6) % 7)); return c; }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function monthEnd(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }

function collectVisits(clinicId) {
  return many("SELECT patient_pk, visit_at FROM appointments WHERE clinic_id=$id", { $id: clinicId })
    .map((r) => ({ patientId: r.patient_pk, visitAt: new Date(Number(r.visit_at || 0)) }))
    .filter((r) => !Number.isNaN(r.visitAt.getTime()));
}

export async function getWeeklyPatientSummary(clinicId, weeks = 4) {
  const total = Math.max(1, Math.min(Number(weeks) || 4, 12));
  const visits = collectVisits(clinicId);
  const currentStart = weekStartMon(new Date());
  const items = [];
  for (let i = total - 1; i >= 0; i -= 1) {
    const start = new Date(currentStart); start.setDate(start.getDate() - i * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
    const s = new Set(); visits.forEach((v) => { if (v.visitAt >= start && v.visitAt <= end) s.add(v.patientId); });
    items.push({ weekStart: fmtDate(start), weekEnd: fmtDate(end), patientCount: s.size });
  }
  return items;
}

export async function getMonthlyPatientSummary(clinicId, months = 6) {
  const total = Math.max(1, Math.min(Number(months) || 6, 24));
  const visits = collectVisits(clinicId);
  const today = new Date();
  const items = [];
  for (let i = total - 1; i >= 0; i -= 1) {
    const md = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = monthStart(md); const end = monthEnd(md);
    const s = new Set(); visits.forEach((v) => { if (v.visitAt >= start && v.visitAt <= end) s.add(v.patientId); });
    items.push({ month: `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, "0")}`, monthStart: fmtDate(start), monthEnd: fmtDate(end), patientCount: s.size });
  }
  return items;
}

export async function getNonRepeatPatients(clinicId) {
  const rows = many(`SELECT p.patient_pk,p.first_name,p.last_name,p.contact_number,p.gender,p.age_years,a.visit_at
    FROM patients p
    LEFT JOIN appointments a ON a.patient_pk=p.patient_pk AND a.clinic_id=p.clinic_id
    WHERE p.clinic_id=$id ORDER BY a.visit_at DESC`, { $id: clinicId });
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.patient_pk)) map.set(r.patient_pk, { id: r.patient_pk, firstName: r.first_name, lastName: r.last_name || "", phone: r.contact_number === null || r.contact_number === undefined ? "" : String(r.contact_number), ageYears: Number(r.age_years || 0), age: `${Number(r.age_years || 0)} year`, gender: fromGenderCode(r.gender), visits: [] });
    if (r.visit_at) map.get(r.patient_pk).visits.push(Number(r.visit_at));
  });
  const out = [];
  map.forEach((p) => { if (p.visits.length === 1) out.push({ ...p, visitCount: 1, lastVisitAt: p.visits[0] }); });
  return out.sort((a, b) => Number(b.lastVisitAt || 0) - Number(a.lastVisitAt || 0));
}

export async function getDataStoreDebugInfo() {
  const clinics = Number(one("SELECT COUNT(*) AS c FROM clinics")?.c || 0);
  const patients = Number(one("SELECT COUNT(*) AS c FROM patients")?.c || 0);
  const appointments = Number(one("SELECT COUNT(*) AS c FROM appointments")?.c || 0);
  return {
    dbFilePath,
    counts: { clinics, patients, appointments }
  };
}

export async function recordRequestMetric({
  requestId,
  route,
  clinicId,
  statusCode,
  latencyMs,
  createdAt = nowTs()
}) {
  const ts = Number(createdAt) || nowTs();
  const retentionMs = Math.max(60_000, Number(config.requestLatencyRetentionHours || 48) * 60 * 60 * 1000);
  run(
    `INSERT INTO request_latency_metrics
      (request_id, route, clinic_id, status_code, latency_ms, created_at)
      VALUES ($requestId, $route, $clinicId, $statusCode, $latencyMs, $createdAt)`,
    {
      $requestId: String(requestId || "").slice(0, 64) || `${ts}`,
      $route: String(route || "").slice(0, 120) || "unknown",
      $clinicId: Math.max(0, Number(clinicId) || 0),
      $statusCode: Math.max(0, Number(statusCode) || 0),
      $latencyMs: Math.max(0, Number(latencyMs) || 0),
      $createdAt: ts
    }
  );
  if (isWithinPurgeWindow(ts) && shouldRunLatencyPurge()) {
    run(
      "DELETE FROM request_latency_metrics WHERE created_at <= $cutoff",
      { $cutoff: ts - retentionMs }
    );
  }
  save();
}

export async function beginIdempotencyRequest({
  clinicId,
  scope,
  idempotencyKey,
  ttlMs = 24 * 60 * 60 * 1000,
  processingTtlMs = 60_000,
  now = nowTs()
}) {
  const cid = Number(clinicId || 0);
  const actionScope = String(scope || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!actionScope || !key) return { state: "processing" };
  const ts = Number(now) || nowTs();
  const exp = ts + Math.max(60_000, Number(ttlMs) || 0);
  const processingExp = ts + Math.max(1_000, Number(processingTtlMs) || 0);
  if (Math.random() < 0.02) {
    run(
      "DELETE FROM idempotency_replays WHERE state='done' AND expires_at <= $now",
      { $now: ts }
    );
  }

  const inserted = run(
    `INSERT INTO idempotency_replays
      (clinic_id,scope,idempotency_key,status_code,response_json,state,processing_expires_at,created_at,updated_at,expires_at)
      VALUES ($clinic,$scope,$key,0,'{}','processing',$processingExp,$created,$updated,$expires)
      ON CONFLICT(clinic_id, scope, idempotency_key) DO NOTHING`,
    {
      $clinic: cid,
      $scope: actionScope,
      $key: key,
      $processingExp: processingExp,
      $created: ts,
      $updated: ts,
      $expires: exp
    }
  );
  if (Number(inserted?.changes || 0) > 0) {
    return { state: "started" };
  }

  const row = one(
    `SELECT state, status_code, response_json, processing_expires_at, expires_at
      FROM idempotency_replays
      WHERE clinic_id=$clinic
        AND scope=$scope
        AND idempotency_key=$key
      LIMIT 1`,
    {
      $clinic: cid,
      $scope: actionScope,
      $key: key
    }
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
  const claimed = run(
    `UPDATE idempotency_replays
      SET state='processing',
          processing_expires_at=$processingExp,
          updated_at=$updated,
          expires_at=$expires
      WHERE clinic_id=$clinic
        AND scope=$scope
        AND idempotency_key=$key
        AND (
          expires_at <= $now
          OR (state='processing' AND COALESCE(processing_expires_at,0) <= $now)
        )`,
    {
      $clinic: cid,
      $scope: actionScope,
      $key: key,
      $processingExp: processingExp,
      $updated: ts,
      $expires: exp,
      $now: ts
    }
  );
  if (Number(claimed?.changes || 0) > 0) {
    return { state: "started" };
  }
  return { state: "processing" };
}

export async function finalizeIdempotencyRequest({
  clinicId,
  scope,
  idempotencyKey,
  statusCode,
  body,
  ttlMs = 24 * 60 * 60 * 1000,
  now = nowTs()
}) {
  const cid = Number(clinicId || 0);
  const actionScope = String(scope || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!actionScope || !key) return;
  const ts = Number(now) || nowTs();
  const exp = ts + Math.max(60_000, Number(ttlMs) || 0);
  run(
    `UPDATE idempotency_replays
      SET state='done',
          status_code=$status,
          response_json=$resp,
          processing_expires_at=NULL,
          updated_at=$updated,
          expires_at=$expires
      WHERE clinic_id=$clinic
        AND scope=$scope
        AND idempotency_key=$key`,
    {
      $clinic: cid,
      $scope: actionScope,
      $key: key,
      $status: Number(statusCode || 200),
      $resp: JSON.stringify(body || {}),
      $updated: ts,
      $expires: exp
    }
  );
  if (Math.random() < 0.02) {
    run(
      "DELETE FROM idempotency_replays WHERE state='done' AND expires_at <= $now",
      { $now: ts }
    );
  }
  save();
}

export async function getIdempotencyReplay(clinicId, scope, idempotencyKey, now = nowTs()) {
  const cid = Number(clinicId || 0);
  const actionScope = String(scope || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!actionScope || !key) return null;
  const row = one(
    `SELECT status_code, response_json
      FROM idempotency_replays
      WHERE clinic_id=$clinic
        AND scope=$scope
        AND idempotency_key=$key
        AND state='done'
        AND expires_at > $now
      LIMIT 1`,
    {
      $clinic: cid,
      $scope: actionScope,
      $key: key,
      $now: Number(now) || nowTs()
    }
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
}

export async function storeIdempotencyReplay({
  clinicId,
  scope,
  idempotencyKey,
  statusCode,
  body,
  ttlMs = 24 * 60 * 60 * 1000,
  now = nowTs()
}) {
  await finalizeIdempotencyRequest({
    clinicId,
    scope,
    idempotencyKey,
    statusCode,
    body,
    ttlMs,
    now
  });
}
