function response(status, body, headers = null) {
  return { status, body, headers };
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

function toAppointmentPayload(body = {}) {
  const bp = parseBpInput(body);
  if (bp.error) return { error: bp.error };
  return {
    payload: {
      bpSystolic: bp.bpSystolic,
      bpDiastolic: bp.bpDiastolic,
      pulse: body.pulse || "",
      oxygenLevel: body.oxygenLevel || "",
      sugar: body.sugar || "",
      thyroid: body.thyroid || "",
      weight: body.weight || "",
      temperature: body.temperature || "",
      pastHistoryCondition: body.pastHistoryCondition || "",
      pastHistory: body.pastHistory || "",
      paymentAmount: body.paymentAmount || "",
      notes: body.notes || ""
    }
  };
}

export function createAppointmentHandlers({ repository, config }) {
  return {
    async create({ user, patientId, body = {}, reports = [], idempotencyKey = "" }) {
      const idemKey = String(idempotencyKey || "").trim();
      if (!idemKey) return response(400, { message: "Idempotency-Key header is required for appointment creation" });
      if (idemKey.length > 128) {
        return response(400, { message: "Idempotency-Key must be at most 128 characters" });
      }

      if (await repository.countAppointmentsAddedInLastMinute(user.sub) >= config.maxAppointmentsPerClinicPerMinute) {
        return rateLimited(
          `Per-minute appointment limit reached (${config.maxAppointmentsPerClinicPerMinute})`,
          getRetryAfterSecondsForMinute()
        );
      }
      if (await repository.countAppointmentsAddedToday(user.sub) >= config.dailyAppointmentLimit) {
        return rateLimited(
          `Daily appointment limit reached (${config.dailyAppointmentLimit})`,
          getRetryAfterSecondsForDay()
        );
      }

      const parsed = toAppointmentPayload(body);
      if (parsed.error) return response(400, { message: parsed.error });
      const begin = await repository.beginIdempotencyRequest({
        clinicId: user.sub,
        scope: "appointment_create",
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

      let appointment;
      try {
        appointment = await repository.addAppointment(user.sub, patientId, parsed.payload, reports);
      } catch {
        const out500 = response(500, { message: "Could not create appointment" });
        await repository.finalizeIdempotencyRequest({
          clinicId: user.sub,
          scope: "appointment_create",
          idempotencyKey: idemKey,
          statusCode: out500.status,
          body: out500.body
        });
        return out500;
      }
      if (!appointment) {
        const out404 = response(404, { message: "Patient not found" });
        await repository.finalizeIdempotencyRequest({
          clinicId: user.sub,
          scope: "appointment_create",
          idempotencyKey: idemKey,
          statusCode: out404.status,
          body: out404.body
        });
        return out404;
      }

      await repository.finalizeIdempotencyRequest({
        clinicId: user.sub,
        scope: "appointment_create",
        idempotencyKey: idemKey,
        statusCode: 201,
        body: appointment
      });
      return response(201, appointment);
    },

    async updateLatest({ user, patientId, appointmentId, body = {}, reports = [] }) {
      const parsed = toAppointmentPayload(body);
      if (parsed.error) return response(400, { message: parsed.error });
      const result = await repository.updateLatestAppointment(
        user.sub,
        patientId,
        appointmentId,
        parsed.payload,
        reports
      );
      if (result.error === "patient_not_found") return response(404, { message: "Patient not found" });
      if (result.error === "appointment_not_found") return response(404, { message: "Appointment not found" });
      if (result.error === "not_latest") return response(400, { message: "Only the latest appointment can be edited" });
      return response(200, result.appointment);
    }
  };
}
