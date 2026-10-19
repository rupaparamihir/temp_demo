function response(status, body, headers = null) {
  return { status, body, headers };
}

function normalizeGender(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "MALE" || v === "M") return "M";
  if (v === "FEMALE" || v === "F") return "F";
  return "";
}

function getRetryAfterSecondsForMinute(now = Date.now()) {
  const msLeft = 60000 - (now % 60000);
  return Math.max(1, Math.ceil(msLeft / 1000));
}

function getRetryAfterSecondsForDay(now = Date.now()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const msLeft = next.getTime() - now;
  return Math.max(1, Math.ceil(msLeft / 1000));
}

function rateLimited(message, retryAfterSeconds) {
  return response(
    429,
    { message },
    { "Retry-After": String(Math.max(1, Math.floor(Number(retryAfterSeconds) || 1))) }
  );
}

function parseBpPart(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") return { value: null };
  if (!/^\d+$/.test(value)) {
    return { error: "BP values must be whole numbers between 0 and 500" };
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 500) {
    return { error: "BP values must be between 0 and 500" };
  }
  return { value: num };
}

function parseBpInput(body = {}) {
  let systolicRaw = body.bpSystolic;
  let diastolicRaw = body.bpDiastolic;
  const legacyBp = String(body.bp || "").trim();
  const bothPartsMissing =
    String(systolicRaw ?? "").trim() === "" &&
    String(diastolicRaw ?? "").trim() === "";
  if (bothPartsMissing && legacyBp) {
    const match = legacyBp.match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
    if (!match) return { error: "BP must be in format systolic/diastolic (example: 148/92)" };
    systolicRaw = match[1];
    diastolicRaw = match[2];
  }
  const systolic = parseBpPart(systolicRaw);
  if (systolic.error) return { error: systolic.error };
  const diastolic = parseBpPart(diastolicRaw);
  if (diastolic.error) return { error: diastolic.error };
  const onlyOneProvided =
    (systolic.value === null && diastolic.value !== null) ||
    (systolic.value !== null && diastolic.value === null);
  if (onlyOneProvided) {
    return { error: "BP requires both systolic and diastolic values (example: 148/92)" };
  }
  return { bpSystolic: systolic.value, bpDiastolic: diastolic.value };
}

function buildFirstAppointmentPayload(body = {}) {
  const bpParsed = parseBpInput(body);
  if (bpParsed.error) return { error: bpParsed.error };
  return {
    payload: {
      bpSystolic: bpParsed.bpSystolic,
      bpDiastolic: bpParsed.bpDiastolic,
      pulse: body.pulse || "",
      oxygenLevel: body.oxygenLevel || "",
      sugar: body.sugar || "",
      thyroid: body.thyroid || "",
      weight: body.weight || "",
      temperature: body.temperature || "",
      pastHistoryCondition: body.pastHistoryCondition || "",
      pastHistory: body.pastHistory || "",
      paymentAmount: body.paymentAmount || "",
      notes: body.appointmentNotes || body.caseNotes || body.notes || ""
    }
  };
}

function parsePagination(input = {}, defaults = {}) {
  const defaultPageSize = Math.max(1, Number(defaults.defaultPageSize) || 20);
  const maxPageSize = Math.max(defaultPageSize, Number(defaults.maxPageSize) || 30);
  const page = Math.max(1, Number(input?.page) || 1);
  const pageSize = Math.max(1, Math.min(maxPageSize, Number(input?.pageSize) || defaultPageSize));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function encodeCursor(obj) {
  const raw = JSON.stringify(obj || {});
  if (typeof Buffer !== "undefined") return Buffer.from(raw, "utf8").toString("base64url");
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursorValue) {
  const value = String(cursorValue || "").trim();
  if (!value) return null;
  try {
    if (typeof Buffer !== "undefined") {
      return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    }
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function createPatientHandlers({ repository, config }) {
  return {
    async create({ user, body = {}, reports = [], idempotencyKey = "" }) {
      const idemKey = String(idempotencyKey || "").trim();
      if (!idemKey) return response(400, { message: "Idempotency-Key header is required for patient creation" });
      if (idemKey.length > 128) {
        return response(400, { message: "Idempotency-Key must be at most 128 characters" });
      }

      const { firstName, lastName, phone, birthYear, age, gender, notes, patientConsent } = body || {};
      if (!firstName) return response(400, { message: "firstName is required" });

      const firstNameClean = String(firstName).trim();
      const lastNameClean = String(lastName || "").trim();
      const namePattern = /^[A-Za-z\s]+$/;
      if (!namePattern.test(firstNameClean) || firstNameClean.length > 30) {
        return response(400, { message: "firstName must be letters only and max 30 characters" });
      }
      if (lastNameClean && (!namePattern.test(lastNameClean) || lastNameClean.length > 30)) {
        return response(400, { message: "lastName must be letters only and max 30 characters" });
      }

      const birthYearValue = String(birthYear ?? age ?? "").trim();
      if (!birthYearValue) return response(400, { message: "Birth year is required" });
      if (!/^\d{4}$/.test(birthYearValue)) return response(400, { message: "Birth year must be a 4-digit number" });
      const birthYearNum = Number(birthYearValue);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(birthYearNum) || birthYearNum < 1900 || birthYearNum > currentYear) {
        return response(400, { message: `Birth year must be between 1900 and ${currentYear}` });
      }
      const ageYears = Math.max(1, currentYear - birthYearNum);

      if (phone) {
        const digits = String(phone).replace(/\D/g, "");
        if (digits.length !== 10) return response(400, { message: "Phone number must be exactly 10 digits" });
      }

      const genderCode = normalizeGender(gender);
      if (gender && !genderCode) return response(400, { message: "Gender must be Male or Female" });

      if (await repository.patientExistsForClinic(user.sub, firstNameClean, lastNameClean, birthYearValue, phone, genderCode)) {
        return response(409, { message: "Patient record already exists with same details" });
      }

      const hasPatientConsent = String(patientConsent || "").toLowerCase() === "true";
      if (!hasPatientConsent) return response(400, { message: "Patient consent is required as per DPDP Act (2023)" });

      const shouldCreateAppointment = String(
        body?.createAppointmentNow ?? body?.createCaseNow ?? ""
      ).toLowerCase() === "true";

      if (await repository.countPatientsAddedInLastMinute(user.sub) >= config.maxNewPatientsPerClinicPerMinute) {
        return rateLimited(
          `Per-minute patient registration limit reached (${config.maxNewPatientsPerClinicPerMinute})`,
          getRetryAfterSecondsForMinute()
        );
      }
      if (await repository.countPatientsAddedToday(user.sub) >= config.dailyPatientLimit) {
        return rateLimited(
          `Daily patient registration limit reached (${config.dailyPatientLimit})`,
          getRetryAfterSecondsForDay()
        );
      }
      if (shouldCreateAppointment && await repository.countAppointmentsAddedInLastMinute(user.sub) >= config.maxAppointmentsPerClinicPerMinute) {
        return rateLimited(
          `Per-minute appointment limit reached (${config.maxAppointmentsPerClinicPerMinute})`,
          getRetryAfterSecondsForMinute()
        );
      }
      if (shouldCreateAppointment && await repository.countAppointmentsAddedToday(user.sub) >= config.dailyAppointmentLimit) {
        return rateLimited(
          `Daily appointment limit reached (${config.dailyAppointmentLimit})`,
          getRetryAfterSecondsForDay()
        );
      }

      let firstAppointmentPayload = null;
      if (shouldCreateAppointment) {
        const parsed = buildFirstAppointmentPayload(body);
        if (parsed.error) return response(400, { message: parsed.error });
        firstAppointmentPayload = parsed.payload;
      }
      const begin = await repository.beginIdempotencyRequest({
        clinicId: user.sub,
        scope: "patient_create",
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

      let out;
      try {
        const patient = await repository.addPatient(user.sub, {
          firstName: firstNameClean,
          lastName: lastNameClean,
          phone,
          birthYear: birthYearValue,
          ageYears,
          gender: genderCode,
          notes,
          consentGiven: hasPatientConsent
        });

        const createdAppointment = shouldCreateAppointment
          ? await repository.addAppointment(user.sub, patient.id, firstAppointmentPayload, reports || [])
          : null;
        out = { status: 201, body: { patient, createdAppointment } };
      } catch {
        out = { status: 500, body: { message: "Could not create patient" } };
      }
      await repository.finalizeIdempotencyRequest({
        clinicId: user.sub,
        scope: "patient_create",
        idempotencyKey: idemKey,
        statusCode: out.status,
        body: out.body
      });
      return response(out.status, out.body);
    },

    async search({ user, query = {} }) {
      const { firstName = "", lastName = "", phone = "" } = query;
      const { page, pageSize, offset } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 30 });
      const cursor = decodeCursor(query.cursor);
      if (String(query.cursor || "").trim() && !cursor) {
        return response(400, { message: "Invalid cursor" });
      }
      const currentMinuteSearches = await repository.incrementPatientSearchCounter(user.sub);
      if (currentMinuteSearches > config.maxPatientSearchesPerClinicPerMinute) {
        return rateLimited(
          `Per-minute patient search limit reached (${config.maxPatientSearchesPerClinicPerMinute})`,
          getRetryAfterSecondsForMinute()
        );
      }
      const rows = await repository.searchPatients(
        user.sub,
        String(firstName),
        String(lastName),
        String(phone),
        cursor
          ? {
              limit: pageSize + 1,
              offset: 0,
              cursorUpdatedAt: cursor.u,
              cursorPatientPk: cursor.id
            }
          : { limit: pageSize + 1, offset }
      );
      const hasMore = rows.length > pageSize;
      const items = hasMore ? rows.slice(0, pageSize) : rows;
      const last = items.length ? items[items.length - 1] : null;
      const nextCursor = hasMore && last
        ? encodeCursor({ u: Number(last.updatedAt || 0), id: Number(last.id || 0) })
        : null;
      return response(200, {
        count: items.length,
        items,
        pagination: {
          mode: cursor ? "cursor" : "offset",
          page,
          pageSize,
          hasMore,
          nextCursor
        }
      });
    },

    async listAppointments({ user, patientId, query = {} }) {
      const { page, pageSize, offset } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 30 });
      const cursor = decodeCursor(query.cursor);
      if (String(query.cursor || "").trim() && !cursor) {
        return response(400, { message: "Invalid cursor" });
      }
      const rows = await repository.listAppointments(
        user.sub,
        patientId,
        cursor
          ? {
              limit: pageSize + 1,
              offset: 0,
              cursorVisitAt: cursor.v,
              cursorAppointmentId: cursor.id
            }
          : { limit: pageSize + 1, offset }
      );
      if (!rows) return response(404, { message: "Patient not found" });
      const hasMore = rows.length > pageSize;
      const items = hasMore ? rows.slice(0, pageSize) : rows;
      const last = items.length ? items[items.length - 1] : null;
      const nextCursor = hasMore && last
        ? encodeCursor({ v: Number(last.visitAt || 0), id: Number(last.id || 0) })
        : null;
      return response(200, {
        count: items.length,
        items,
        pagination: {
          mode: cursor ? "cursor" : "offset",
          page,
          pageSize,
          hasMore,
          nextCursor
        }
      });
    }
  };
}
