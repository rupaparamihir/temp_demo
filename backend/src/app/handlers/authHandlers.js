function normalizeGender(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "MALE" || v === "M") return "M";
  if (v === "FEMALE" || v === "F") return "F";
  return "";
}

function getSessionExpiryTs(config) {
  return Date.now() + (config.jwtTtlHours * 60 * 60 * 1000);
}

function getRetryAfterSecondsForDay(now = Date.now()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const msLeft = next.getTime() - now;
  return Math.max(1, Math.ceil(msLeft / 1000));
}

function response(status, body, headers = null) {
  return { status, body, headers };
}

const loginFailuresByIdentifierIp = new Map();
const loginFailuresByIdentifier = new Map();

function getRetryAfterSeconds(ms) {
  return Math.max(1, Math.ceil(Math.max(0, Number(ms) || 0) / 1000));
}

function pruneOldTimestamps(items, cutoffTs) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.filter((ts) => Number(ts) >= cutoffTs);
}

function normalizeLoginIdentifier(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits) return digits;
  return raw.toLowerCase();
}

function getLoginThrottleConfig(config = {}) {
  const identifierIpWindowMs = 60_000;
  const identifierWindowMs = 5 * 60_000;
  return {
    identifierIpWindowMs,
    maxFailedLoginsPerIdentifierIpPerMinute: Math.max(
      1,
      Number(config.maxFailedLoginsPerIdentifierIpPerMinute) || 5
    ),
    failedLoginIdentifierIpCooldownMs: Math.max(
      1_000,
      Number(config.failedLoginIdentifierIpCooldownSeconds || 60) * 1000
    ),
    identifierWindowMs,
    maxFailedLoginsPerIdentifierInFiveMinutes: Math.max(
      1,
      Number(config.maxFailedLoginsPerIdentifierInFiveMinutes) || 20
    ),
    failedLoginIdentifierBackoffMs: [
      Math.max(1_000, Number(config.failedLoginIdentifierBackoffLevel1Seconds || 120) * 1000),
      Math.max(1_000, Number(config.failedLoginIdentifierBackoffLevel2Seconds || 900) * 1000),
      Math.max(1_000, Number(config.failedLoginIdentifierBackoffLevel3Seconds || 1800) * 1000)
    ]
  };
}

function maybeGetLoginThrottleResponse(identifier, ip, config, now = Date.now()) {
  const id = normalizeLoginIdentifier(identifier);
  const sourceIp = String(ip || "unknown").trim() || "unknown";
  const key = `${id}|${sourceIp}`;
  const pairState = loginFailuresByIdentifierIp.get(key);
  if (pairState?.cooldownUntil && Number(pairState.cooldownUntil) > now) {
    const retryAfter = getRetryAfterSeconds(Number(pairState.cooldownUntil) - now);
    return response(
      429,
      { message: "Too many failed login attempts. Try again in about 1 minute." },
      { "Retry-After": String(retryAfter) }
    );
  }
  const identifierState = loginFailuresByIdentifier.get(id);
  if (identifierState?.backoffUntil && Number(identifierState.backoffUntil) > now) {
    const retryAfter = getRetryAfterSeconds(Number(identifierState.backoffUntil) - now);
    return response(
      429,
      { message: "Too many failed login attempts for this login identifier. Try again later." },
      { "Retry-After": String(retryAfter) }
    );
  }

  if (Math.random() < 0.02) {
    for (const [k, state] of loginFailuresByIdentifierIp.entries()) {
      const pairTimestamps = pruneOldTimestamps(
        state?.timestamps || [],
        now - config.identifierIpWindowMs
      );
      const cooldownActive = Number(state?.cooldownUntil || 0) > now;
      if (pairTimestamps.length === 0 && !cooldownActive) {
        loginFailuresByIdentifierIp.delete(k);
      } else if (pairTimestamps.length !== (state?.timestamps || []).length) {
        loginFailuresByIdentifierIp.set(k, {
          ...state,
          timestamps: pairTimestamps
        });
      }
    }
    for (const [k, state] of loginFailuresByIdentifier.entries()) {
      const idTimestamps = pruneOldTimestamps(
        state?.timestamps || [],
        now - config.identifierWindowMs
      );
      const backoffActive = Number(state?.backoffUntil || 0) > now;
      if (idTimestamps.length === 0 && !backoffActive && Number(state?.backoffLevel || 0) <= 0) {
        loginFailuresByIdentifier.delete(k);
      } else if (idTimestamps.length !== (state?.timestamps || []).length) {
        loginFailuresByIdentifier.set(k, {
          ...state,
          timestamps: idTimestamps
        });
      }
    }
  }

  return null;
}

function recordFailedLoginAttempt(identifier, ip, config, now = Date.now()) {
  const id = normalizeLoginIdentifier(identifier);
  const sourceIp = String(ip || "unknown").trim() || "unknown";
  const pairKey = `${id}|${sourceIp}`;

  const pairState = loginFailuresByIdentifierIp.get(pairKey) || { timestamps: [], cooldownUntil: 0 };
  pairState.timestamps = pruneOldTimestamps(
    [...(pairState.timestamps || []), now],
    now - config.identifierIpWindowMs
  );
  if (pairState.timestamps.length >= config.maxFailedLoginsPerIdentifierIpPerMinute) {
    pairState.cooldownUntil = now + config.failedLoginIdentifierIpCooldownMs;
  }
  loginFailuresByIdentifierIp.set(pairKey, pairState);

  const idState = loginFailuresByIdentifier.get(id) || {
    timestamps: [],
    backoffUntil: 0,
    backoffLevel: 0
  };
  idState.timestamps = pruneOldTimestamps(
    [...(idState.timestamps || []), now],
    now - config.identifierWindowMs
  );
  if (idState.timestamps.length >= config.maxFailedLoginsPerIdentifierInFiveMinutes) {
    const level = Math.max(0, Number(idState.backoffLevel) || 0);
    const duration = config.failedLoginIdentifierBackoffMs[
      Math.min(level, config.failedLoginIdentifierBackoffMs.length - 1)
    ];
    idState.backoffUntil = now + duration;
    idState.backoffLevel = Math.min(level + 1, config.failedLoginIdentifierBackoffMs.length);
    idState.timestamps = [];
  }
  loginFailuresByIdentifier.set(id, idState);
}

function clearLoginThrottleState(identifier, ip) {
  const id = normalizeLoginIdentifier(identifier);
  const sourceIp = String(ip || "unknown").trim() || "unknown";
  loginFailuresByIdentifierIp.delete(`${id}|${sourceIp}`);
  loginFailuresByIdentifier.delete(id);
}

export function createAuthHandlers({ repository, config, signToken, randomUUID }) {
  return {
    async register({ body = {}, ip = "unknown", idempotencyKey = "" }) {
      const idemKey = String(idempotencyKey || "").trim();
      if (idemKey.length > 128) {
        return response(400, { message: "Idempotency-Key must be at most 128 characters" });
      }
      let idempotencyStarted = false;
      const {
        doctorFullName = "",
        doctorQualification = "",
        doctorGender = "",
        clinicName = "",
        clinicAddress = "",
        clinicPincode = "",
        clinicCity = "",
        clinicState = "",
        clinicContactNumber = "",
        clinicEmailId = "",
        loginPassword = "",
        key = "",
        consentGiven = false
      } = body;

      if (
        !doctorFullName ||
        !doctorQualification ||
        !doctorGender ||
        !clinicName ||
        !clinicAddress ||
        !clinicPincode ||
        !clinicCity ||
        !clinicState ||
        !clinicContactNumber ||
        !clinicEmailId ||
        !loginPassword ||
        !key
      ) {
        return response(400, { message: "All clinic registration fields are required" });
      }

      const pincode = String(clinicPincode).trim();
      if (!/^\d{6}$/.test(pincode)) {
        return response(400, { message: "Clinic pincode must be a 6-digit number" });
      }

      const contactDigits = String(clinicContactNumber).replace(/\D/g, "");
      if (contactDigits.length < 10) {
        return response(400, { message: "Clinic contact number must be at least 10 digits" });
      }

      const email = String(clinicEmailId).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return response(400, { message: "Clinic email id is invalid" });
      }

      if (String(loginPassword).length < 6) {
        return response(400, { message: "Login password must be at least 6 characters" });
      }

      if (!["GP", "BHMS", "BAMS", "MBBS", "BDS"].includes(String(doctorQualification))) {
        return response(400, { message: "Doctor qualification is invalid" });
      }
      const doctorGenderCode = normalizeGender(doctorGender);
      if (!doctorGenderCode) {
        return response(400, { message: "Doctor gender is invalid" });
      }

      if (consentGiven !== true) {
        return response(400, { message: "Consent is required as per DPDP Act (2023)" });
      }

      const registrationKey = String(key).trim();
      if (!/^\d{5}$/.test(registrationKey)) {
        return response(400, { message: "Key must be a 5-digit number" });
      }
      if (registrationKey !== config.registrationKey) {
        return response(403, { message: "Invalid registration key" });
      }

      if (await repository.countClinicsRegisteredToday() >= config.maxClinicRegistrationsPerDay) {
        return response(
          429,
          { message: `Daily clinic registration limit reached (${config.maxClinicRegistrationsPerDay})` },
          { "Retry-After": String(getRetryAfterSecondsForDay()) }
        );
      }
      if (idemKey) {
        const begin = await repository.beginIdempotencyRequest({
          clinicId: 0,
          scope: "clinic_register",
          idempotencyKey: idemKey
        });
        if (begin.state === "replay") {
          return response(begin.replay?.statusCode || 200, begin.replay?.body || {}, { "Idempotency-Replayed": "true" });
        }
        if (begin.state === "processing") {
          return response(
            409,
            { ok: false, error: "Request in progress", retryAfterSeconds: 1 },
            { "Retry-After": "1", "Idempotency-Key": idemKey }
          );
        }
        idempotencyStarted = begin.state === "started";
      }

      let out;
      try {
        const clinic = await repository.addClinic({
          doctorFullName,
          doctorQualification,
          doctorGender: doctorGenderCode,
          clinicName,
          clinicAddress,
          clinicPincode: pincode,
          clinicCity,
          clinicState,
          clinicContactNumber: contactDigits,
          clinicEmailId: email,
          loginPassword,
          consentGiven
        });

        const sessionId = randomUUID();
        const token = await signToken(clinic, sessionId);
        await repository.recordLoginSession({
          clinicId: clinic.id,
          sessionId,
          ipAddress: ip,
          expiresAt: getSessionExpiryTs(config)
        });
        out = response(201, {
          token,
          clinic: {
            id: clinic.id,
            name: clinic.name,
            clinicCode: clinic.clinicCode
          }
        });
      } catch (err) {
        out = response(409, { message: err.message || "Could not register clinic" });
      }
      if (idemKey && idempotencyStarted) {
        await repository.finalizeIdempotencyRequest({
          clinicId: 0,
          scope: "clinic_register",
          idempotencyKey: idemKey,
          statusCode: out.status,
          body: out.body
        });
      }
      return out;
    },

    async login({ body = {}, ip = "unknown" }) {
      const { clinicCode, loginId, password } = body;
      const clinicLoginId = String(loginId || clinicCode || "").trim();
      if (!clinicLoginId || !password) {
        return response(400, { message: "clinicCode/contact number and password are required" });
      }

      const throttleConfig = getLoginThrottleConfig(config);
      const blocked = maybeGetLoginThrottleResponse(clinicLoginId, ip, throttleConfig);
      if (blocked) return blocked;

      const clinic = await repository.findClinicByCode(clinicLoginId);
      if (!clinic || !(await repository.verifyClinicPassword(clinic, password))) {
        recordFailedLoginAttempt(clinicLoginId, ip, throttleConfig);
        return response(401, { message: "Invalid credentials" });
      }

      try {
        clearLoginThrottleState(clinicLoginId, ip);
        const sessionId = randomUUID();
        const token = await signToken(clinic, sessionId);
        await repository.recordLoginSession({
          clinicId: clinic.id,
          sessionId,
          ipAddress: ip,
          expiresAt: getSessionExpiryTs(config)
        });
        return response(200, {
          token,
          clinic: {
            id: clinic.id,
            name: clinic.name,
            clinicCode: clinic.clinicCode
          }
        });
      } catch (err) {
        console.error("Could not write login audit record", err);
        return response(500, { message: "Could not complete login" });
      }
    },

    async ping({ user }) {
      try {
        const valid = await repository.validateSession(user.sub, String(user.jti || ""), Date.now());
        if (!valid) return response(401, { message: "Invalid session" });
        const touched = await repository.touchSessionHeartbeat(user.sub, String(user.jti || ""), Date.now());
        return response(200, { ok: true, touched });
      } catch (err) {
        console.error("Could not update session heartbeat", err);
        return response(500, { message: "Could not update heartbeat" });
      }
    },

    async logout({ user, ip = "unknown" }) {
      try {
        const valid = await repository.validateSession(user.sub, String(user.jti || ""), Date.now());
        if (!valid) return response(401, { message: "Invalid session" });
        const closed = await repository.recordLogoutSession(
          user.sub,
          String(user.jti || ""),
          Date.now(),
          ip
        );
        return response(200, {
          message: "Logged out",
          auditUpdated: closed
        });
      } catch (err) {
        console.error("Could not write logout audit record", err);
        return response(500, { message: "Could not complete logout" });
      }
    },

    async me({ user }) {
      const valid = await repository.validateSession(user.sub, String(user.jti || ""), Date.now());
      if (!valid) {
        return response(401, { message: "Invalid session" });
      }
      const clinic = await repository.findClinicById(user.sub);
      if (!clinic) {
        return response(401, { message: "Invalid session" });
      }
      return response(200, {
        clinic: {
          id: clinic.id,
          name: clinic.name,
          clinicCode: clinic.clinicCode
        }
      });
    },

    async resetPassword({ body = {} }) {
      const { contactNumber = "", clinicContactNumber = "", email = "", newPassword = "" } = body;
      const contactValue = String(contactNumber || clinicContactNumber || "").replace(/\D/g, "");
      const emailValue = String(email || "").trim().toLowerCase();
      const passwordValue = String(newPassword || "");

      if (!contactValue || !emailValue || !passwordValue) {
        return response(400, { message: "Contact number, email id and new password are required" });
      }
      if (contactValue.length < 10) {
        return response(400, { message: "Contact number must be at least 10 digits" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        return response(400, { message: "Email id is invalid" });
      }
      if (passwordValue.length > 6) {
        return response(400, { message: "New password must be at most 6 characters" });
      }

      const updated = await repository.resetClinicPassword(contactValue, emailValue, passwordValue);
      if (!updated) {
        return response(401, { message: "Incorrect number/email id" });
      }

      return response(200, { message: "Password reset successful" });
    }
  };
}
