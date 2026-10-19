function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createWorkerConfig(env = {}) {
  const port = toNumber(env.PORT, 4000);
  return {
    port,
    dbProvider: String(env.DB_PROVIDER || "d1"),
    jwtSecret: String(env.JWT_SECRET || "dev_only_change_me"),
    registrationKey: String(env.REGISTRATION_KEY || "12345"),
    passwordPbkdf2Iterations: Math.max(10000, toNumber(env.PASSWORD_PBKDF2_ITERATIONS, 10000)),
    corsOrigin: String(env.CORS_ORIGIN || ""),
    publicBaseUrl: String(env.PUBLIC_BASE_URL || `http://localhost:${port}`),
    jwtTtlHours: Math.max(1, toNumber(env.JWT_TTL_HOURS, 8)),
    heartbeatIntervalMs: Math.max(60000, toNumber(env.HEARTBEAT_INTERVAL_MS, 300000)),
    heartbeatJitterMs: Math.max(0, toNumber(env.HEARTBEAT_JITTER_MS, 20000)),
    maxFailedLoginsPerIdentifierIpPerMinute: Math.max(1, toNumber(env.MAX_FAILED_LOGINS_PER_IDENTIFIER_IP_PER_MINUTE, 5)),
    failedLoginIdentifierIpCooldownSeconds: Math.max(1, toNumber(env.FAILED_LOGIN_IDENTIFIER_IP_COOLDOWN_SECONDS, 60)),
    maxFailedLoginsPerIdentifierInFiveMinutes: Math.max(1, toNumber(env.MAX_FAILED_LOGINS_PER_IDENTIFIER_IN_FIVE_MINUTES, 20)),
    failedLoginIdentifierBackoffLevel1Seconds: Math.max(1, toNumber(env.FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL1_SECONDS, 120)),
    failedLoginIdentifierBackoffLevel2Seconds: Math.max(1, toNumber(env.FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL2_SECONDS, 900)),
    failedLoginIdentifierBackoffLevel3Seconds: Math.max(1, toNumber(env.FAILED_LOGIN_IDENTIFIER_BACKOFF_LEVEL3_SECONDS, 1800)),
    maxClinicRegistrationsPerDay: Math.max(1, toNumber(env.MAX_CLINIC_REGISTRATIONS_PER_DAY, 20)),
    maxNewPatientsPerClinicPerMinute: Math.max(1, toNumber(env.MAX_NEW_PATIENTS_PER_CLINIC_PER_MINUTE, 1)),
    maxPatientSearchesPerClinicPerMinute: Math.max(1, toNumber(env.MAX_PATIENT_SEARCHES_PER_CLINIC_PER_MINUTE, 20)),
    maxAppointmentsPerClinicPerMinute: Math.max(1, toNumber(env.MAX_APPOINTMENTS_PER_CLINIC_PER_MINUTE, 1)),
    maxUnauthRequestsPerIpPerMinute: Math.max(1, toNumber(env.MAX_UNAUTH_REQUESTS_PER_IP_PER_MINUTE, 10)),
    requestLatencyRetentionHours: Math.max(1, toNumber(env.REQUEST_LATENCY_RETENTION_HOURS, 48)),
    requestLatencyPurgeStartHour: Math.max(0, Math.min(23, toNumber(env.REQUEST_LATENCY_PURGE_START_HOUR, 2))),
    requestLatencyPurgeEndHour: Math.max(0, Math.min(23, toNumber(env.REQUEST_LATENCY_PURGE_END_HOUR, 5))),
    requestLatencyPurgeSampleRatePercent: Math.max(1, Math.min(100, toNumber(env.REQUEST_LATENCY_PURGE_SAMPLE_RATE_PERCENT, 5))),
    dailyPatientLimit: Math.max(1, toNumber(env.DAILY_PATIENT_LIMIT, 100)),
    dailyAppointmentLimit: Math.max(1, toNumber(env.DAILY_APPOINTMENT_LIMIT, 100)),
    allowSchemaCreate: String(env.ALLOW_SCHEMA_CREATE || "").toLowerCase() === "true"
  };
}
