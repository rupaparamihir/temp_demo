-- Database: Test (local SQLite / sql.js persisted as backend/Test.db)

CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  clinic_code TEXT NOT NULL UNIQUE,
  doctor_full_name TEXT NOT NULL,
  doctor_qualification TEXT NOT NULL,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id TEXT NOT NULL,
  clinic_patient_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  phone TEXT,
  birth_year INTEGER NOT NULL,
  age_years INTEGER NOT NULL,
  gender TEXT,
  notes TEXT,
  consent_given INTEGER NOT NULL,
  medical_history TEXT NOT NULL DEFAULT 'NO',
  last_appointment_no INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (clinic_id) REFERENCES clinics(id),
  UNIQUE (clinic_id, clinic_patient_id),
  CHECK (clinic_patient_id >= 1 AND clinic_patient_id <= 9999)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
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
  FOREIGN KEY (clinic_id) REFERENCES clinics(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  UNIQUE (patient_id, appointment_number)
);

CREATE INDEX IF NOT EXISTS idx_clinics_code ON clinics(clinic_code);
CREATE INDEX IF NOT EXISTS idx_clinics_contact ON clinics(contact_number);
CREATE INDEX IF NOT EXISTS idx_clinics_email ON clinics(email);
CREATE INDEX IF NOT EXISTS idx_clinics_updated ON clinics(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_name ON patients(clinic_id, first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone ON patients(clinic_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_updated ON patients(clinic_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_visit ON appointments(clinic_id, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_updated ON appointments(clinic_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_patient_visit ON appointments(clinic_id, patient_id, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_visit ON appointments(patient_id, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_updated ON appointments(patient_id, updated_at DESC);
