/**
 * Repository contract used by the API layer.
 * Any backend provider (local SQLite, Cloudflare D1) must implement
 * the same function names and return shapes.
 */
export const repositoryContract = {
  initDataStore: "function() => Promise<void>",
  findClinicByCode: "async function(clinicCode) => clinic|null",
  findClinicById: "async function(clinicId) => clinic|null",
  verifyClinicPassword: "async function(clinic, password) => boolean",
  recordLoginSession: "async function({clinicId, sessionId, ipAddress, loginAt?}) => void",
  recordLogoutSession: "async function(clinicId, sessionId, logoutAt?, ipAddress?) => boolean",
  touchSessionHeartbeat: "async function(clinicId, sessionId, seenAt?) => boolean",
  validateSession: "async function(clinicId, sessionId, now?) => boolean",
  countClinicsRegisteredToday: "async function() => number",
  countPatientsAddedInLastMinute: "async function(clinicId, now?) => number",
  countAppointmentsAddedInLastMinute: "async function(clinicId, now?) => number",
  incrementPatientSearchCounter: "async function(clinicId, now?) => number",
  resetClinicPassword: "async function(contactNumber, email, newPassword) => boolean",
  addClinic: "async function(payload) => clinic",
  addPatient: "async function(clinicId, payload) => patient",
  patientExistsForClinic: "async function(clinicId, firstName, lastName, birthYear, phone, gender) => boolean",
  searchPatients: "async function(clinicId, firstName, lastName, phone, options?) => patient[]",
  addAppointment: "async function(clinicId, patientId, payload, reports) => appointment|null",
  listAppointments: "async function(clinicId, patientId, options?) => appointment[]|null",
  updateLatestAppointment: "async function(clinicId, patientId, appointmentId, payload, reports) => {error?}|{appointment}",
  countPatientsAddedToday: "async function(clinicId) => number",
  countAppointmentsAddedToday: "async function(clinicId) => number",
  getWeeklyPatientSummary: "async function(clinicId, weeks) => summary[]",
  getMonthlyPatientSummary: "async function(clinicId, months) => summary[]",
  getNonRepeatPatients: "async function(clinicId) => patient[]",
  getDataStoreDebugInfo: "async function() => {dbFilePath, counts}",
  recordRequestMetric: "async function({requestId, route, clinicId, statusCode, latencyMs, createdAt?}) => void",
  beginIdempotencyRequest: "async function({clinicId, scope, idempotencyKey, ttlMs?, processingTtlMs?, now?}) => {state:'started'|'replay'|'processing', replay?}",
  finalizeIdempotencyRequest: "async function({clinicId, scope, idempotencyKey, statusCode, body, ttlMs?, now?}) => void",
  getIdempotencyReplay: "async function(clinicId, scope, idempotencyKey, now?) => {statusCode, body}|null",
  storeIdempotencyReplay: "async function({clinicId, scope, idempotencyKey, statusCode, body, ttlMs?, now?}) => void"
};
