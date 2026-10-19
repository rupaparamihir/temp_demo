const API_BASE = String(import.meta.env.VITE_API_BASE || "/api").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(import.meta.env.VITE_API_TIMEOUT_MS) || 15000);
const IDEM_HEADER = "Idempotency-Key";

function generateIdempotencyKey(prefix = "idem") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Request timed out. Please check backend/network and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) {
    if (!res.ok) {
      throw new Error(res.status >= 500 ? "Server error. Please try again." : `Request failed (status ${res.status})`);
    }
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(res.status >= 500 ? "Server error. Please try again." : `Unexpected server response (status ${res.status})`);
  }
}

export async function login(loginId, password) {
  const res = await apiFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId, clinicCode: loginId, password })
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Login failed");
  return data;
}

export async function registerClinic(payload) {
  const res = await apiFetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Registration failed");
  return data;
}

export async function resetPassword(payload) {
  const res = await apiFetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not reset password");
  return data;
}

export async function getCurrentSession(token) {
  const res = await apiFetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Session is invalid");
  return data;
}

export async function logoutSession(token) {
  const res = await apiFetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Logout failed");
  return data;
}

export async function pingSession(token) {
  const res = await apiFetch(`${API_BASE}/auth/ping`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Heartbeat failed");
  return data;
}

export async function addPatient(token, payload) {
  const isFormData = payload instanceof FormData;
  const headers = isFormData
    ? { Authorization: `Bearer ${token}`, [IDEM_HEADER]: generateIdempotencyKey("patient") }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        [IDEM_HEADER]: generateIdempotencyKey("patient")
      };

  const res = await apiFetch(`${API_BASE}/patients`, {
    method: "POST",
    headers,
    body: isFormData ? payload : JSON.stringify(payload)
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not add patient");
  return data;
}

export async function searchPatients(token, firstName, lastName, phone = "") {
  const query = new URLSearchParams({ firstName, lastName, phone }).toString();
  const res = await apiFetch(`${API_BASE}/patients/search?${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Search failed");
  return data;
}

export async function getPatientAppointments(token, patientId) {
  const res = await apiFetch(`${API_BASE}/patients/${patientId}/appointments`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not load appointments");
  return data;
}

export async function addPatientAppointment(token, patientId, payload) {
  const formData = new FormData();
  formData.append("bpSystolic", payload.bpSystolic || "");
  formData.append("bpDiastolic", payload.bpDiastolic || "");
  formData.append("pulse", payload.pulse || "");
  formData.append("oxygenLevel", payload.oxygenLevel || "");
  formData.append("sugar", payload.sugar || "");
  formData.append("thyroid", payload.thyroid || "");
  formData.append("weight", payload.weight || "");
  formData.append("temperature", payload.temperature || "");
  formData.append("pastHistoryCondition", payload.pastHistoryCondition || "");
  formData.append("pastHistory", payload.pastHistory || "");
  formData.append("paymentAmount", payload.paymentAmount || "");
  formData.append("notes", payload.notes || "");
  (payload.reports || []).forEach((file) => formData.append("reports", file));

  const res = await apiFetch(`${API_BASE}/patients/${patientId}/appointments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, [IDEM_HEADER]: generateIdempotencyKey("appointment") },
    body: formData
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not add appointment");
  return data;
}

export async function updateLatestPatientAppointment(token, patientId, appointmentId, payload) {
  const formData = new FormData();
  formData.append("bpSystolic", payload.bpSystolic || "");
  formData.append("bpDiastolic", payload.bpDiastolic || "");
  formData.append("pulse", payload.pulse || "");
  formData.append("oxygenLevel", payload.oxygenLevel || "");
  formData.append("sugar", payload.sugar || "");
  formData.append("thyroid", payload.thyroid || "");
  formData.append("weight", payload.weight || "");
  formData.append("temperature", payload.temperature || "");
  formData.append("pastHistoryCondition", payload.pastHistoryCondition || "");
  formData.append("pastHistory", payload.pastHistory || "");
  formData.append("paymentAmount", payload.paymentAmount || "");
  formData.append("notes", payload.notes || "");
  (payload.reports || []).forEach((file) => formData.append("reports", file));

  const res = await apiFetch(`${API_BASE}/patients/${patientId}/appointments/${appointmentId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not update appointment");
  return data;
}

export async function getPatientCases(token, patientId) {
  return getPatientAppointments(token, patientId);
}

export async function openNewCase(token, patientId, payload) {
  return addPatientAppointment(token, patientId, payload);
}

export async function addCaseAppointment(token, patientId, _caseId, payload) {
  return addPatientAppointment(token, patientId, payload);
}

export async function getWeeklyPatientsSummary(token, weeks = 4) {
  const query = new URLSearchParams({ weeks: String(weeks) }).toString();
  const res = await apiFetch(`${API_BASE}/summary/weekly-patients?${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not load weekly patients summary");
  return data;
}

export async function getMonthlyPatientsSummary(token, months = 6) {
  const query = new URLSearchParams({ months: String(months) }).toString();
  const res = await apiFetch(`${API_BASE}/summary/monthly-patients?${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not load monthly patients summary");
  return data;
}

export async function getNonRepeatPatientsSummary(token) {
  const res = await apiFetch(`${API_BASE}/summary/non-repeat-patients`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data.message || "Could not load non-repeat patients");
  return data;
}
