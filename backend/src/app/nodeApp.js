import cors from "cors";
import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { authenticate } from "../auth.node.js";
import { randomUUID } from "crypto";
import { signToken } from "../auth.node.js";
import { createAuthHandlers } from "./handlers/authHandlers.js";
import { createPatientHandlers } from "./handlers/patientHandlers.js";
import { createAppointmentHandlers } from "./handlers/appointmentHandlers.js";
import { config } from "../config.node.js";
import { repository } from "../db/index.node.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`);
  }
});
const upload = multer({ storage });

function mapUploadedFiles(files = []) {
  return files.map((file) => ({
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `${config.publicBaseUrl}/uploads/${file.filename}`
  }));
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = forwarded || String(req.ip || req.socket?.remoteAddress || "").trim();
  if (!raw) return "unknown";
  return raw.replace(/^::ffff:/, "").slice(0, 45);
}

function normalizeGender(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "MALE" || v === "M") return "M";
  if (v === "FEMALE" || v === "F") return "F";
  return "";
}

function getSessionExpiryTs() {
  return Date.now() + (config.jwtTtlHours * 60 * 60 * 1000);
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

function respondRateLimited(res, message, retryAfterSeconds) {
  res.set("Retry-After", String(Math.max(1, Math.floor(Number(retryAfterSeconds) || 1))));
  return res.status(429).json({ message });
}

function sendApiResult(res, result) {
  if (result?.headers) {
    Object.entries(result.headers).forEach(([k, v]) => res.set(k, String(v)));
  }
  return res.status(Number(result?.status || 200)).json(result?.body || {});
}

function getRouteKey(req) {
  const routePath = req?.route?.path ? String(req.route.path) : String(req.path || req.originalUrl || "unknown");
  const base = String(req.baseUrl || "");
  const full = `${base}${routePath}` || "unknown";
  return full.slice(0, 120);
}

function getIdempotencyKey(req) {
  return String(req.headers["idempotency-key"] || "").trim();
}

const unauthIpMinuteCounters = new Map();

function incrementUnauthIpCounter(ipAddress, now = Date.now()) {
  const ip = String(ipAddress || "unknown").trim() || "unknown";
  const bucket = Math.floor(now / 60000);
  const key = `${ip}|${bucket}`;
  const count = Number(unauthIpMinuteCounters.get(key) || 0) + 1;
  unauthIpMinuteCounters.set(key, count);
  if (Math.random() < 0.02) {
    const minBucketToKeep = bucket - 2;
    for (const existingKey of unauthIpMinuteCounters.keys()) {
      const parts = existingKey.split("|");
      const existingBucket = Number(parts[parts.length - 1] || 0);
      if (existingBucket < minBucketToKeep) {
        unauthIpMinuteCounters.delete(existingKey);
      }
    }
  }
  return count;
}

function enforceUnauthGlobalLimit(req, res) {
  const current = incrementUnauthIpCounter(getClientIp(req));
  if (current <= config.maxUnauthRequestsPerIpPerMinute) return null;
  return respondRateLimited(
    res,
    `Too many unauthenticated requests from this IP (${config.maxUnauthRequestsPerIpPerMinute}/minute)`,
    getRetryAfterSecondsForMinute()
  );
}

async function sendIdempotencyReplayIfAvailable(req, res, clinicId, scope) {
  const key = getIdempotencyKey(req);
  if (!key) return false;
  if (key.length > 128) {
    res.status(400).json({ message: "Idempotency-Key must be at most 128 characters" });
    return true;
  }
  const replay = await repository.getIdempotencyReplay(clinicId, scope, key);
  if (!replay) return false;
  res.status(Number(replay.statusCode || 200)).json(replay.body || {});
  return true;
}

async function storeIdempotencyReplayIfPresent(req, clinicId, scope, statusCode, body) {
  const key = getIdempotencyKey(req);
  if (!key) return;
  await repository.storeIdempotencyReplay({
    clinicId,
    scope,
    idempotencyKey: key,
    statusCode,
    body
  });
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const authHandlers = createAuthHandlers({
  repository,
  config,
  signToken,
  randomUUID
});
const patientHandlers = createPatientHandlers({ repository, config });
const appointmentHandlers = createAppointmentHandlers({ repository, config });

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
    if (!match) {
      return { error: "BP must be in format systolic/diastolic (example: 148/92)" };
    }
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

  return {
    bpSystolic: systolic.value,
    bpDiastolic: diastolic.value
  };
}

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use("/uploads", express.static(uploadDir));
app.use((req, res, next) => {
  const startedAt = Date.now();
  const incomingRequestId = String(req.headers["x-request-id"] || "").trim();
  const requestId = incomingRequestId || randomUUID();
  res.set("x-request-id", requestId);
  res.on("finish", () => {
    Promise.resolve(
      repository.recordRequestMetric({
        requestId,
        route: getRouteKey(req),
        clinicId: Number(req?.user?.sub || 0),
        statusCode: Number(res.statusCode || 0),
        latencyMs: Math.max(0, Date.now() - startedAt),
        createdAt: Date.now()
      })
    ).catch(() => {});
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/debug/db-info", asyncRoute(async (_req, res) => {
  return res.json(await repository.getDataStoreDebugInfo());
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const limited = enforceUnauthGlobalLimit(req, res);
  if (limited) return limited;
  const result = await authHandlers.register({
    body: req.body || {},
    ip: getClientIp(req),
    idempotencyKey: getIdempotencyKey(req)
  });
  return sendApiResult(res, result);
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const limited = enforceUnauthGlobalLimit(req, res);
  if (limited) return limited;
  const result = await authHandlers.login({
    body: req.body || {},
    ip: getClientIp(req)
  });
  return sendApiResult(res, result);
}));

app.post("/api/auth/ping", authenticate, asyncRoute(async (req, res) => {
  const result = await authHandlers.ping({ user: req.user });
  return sendApiResult(res, result);
}));

app.post("/api/auth/logout", authenticate, asyncRoute(async (req, res) => {
  const result = await authHandlers.logout({
    user: req.user,
    ip: getClientIp(req)
  });
  return sendApiResult(res, result);
}));

app.get("/api/auth/me", authenticate, asyncRoute(async (req, res) => {
  const result = await authHandlers.me({ user: req.user });
  return sendApiResult(res, result);
}));

app.post("/api/auth/reset-password", asyncRoute(async (req, res) => {
  const limited = enforceUnauthGlobalLimit(req, res);
  if (limited) return limited;
  const result = await authHandlers.resetPassword({ body: req.body || {} });
  return sendApiResult(res, result);
}));

app.post("/api/patients", authenticate, upload.array("reports", 6), asyncRoute(async (req, res) => {
  const result = await patientHandlers.create({
    user: req.user,
    body: req.body || {},
    reports: mapUploadedFiles(req.files || []),
    idempotencyKey: getIdempotencyKey(req)
  });
  return sendApiResult(res, result);
}));

app.get("/api/patients/search", authenticate, asyncRoute(async (req, res) => {
  const result = await patientHandlers.search({ user: req.user, query: req.query || {} });
  return sendApiResult(res, result);
}));

app.get("/api/patients/:patientId/appointments", authenticate, asyncRoute(async (req, res) => {
  const result = await patientHandlers.listAppointments({
    user: req.user,
    patientId: req.params.patientId,
    query: req.query || {}
  });
  return sendApiResult(res, result);
}));

app.get("/api/summary/weekly-patients", authenticate, asyncRoute(async (req, res) => {
  const weeks = Number(req.query.weeks || 4);
  const items = await repository.getWeeklyPatientSummary(req.user.sub, weeks);
  return res.json({ count: items.length, items });
}));

app.get("/api/summary/monthly-patients", authenticate, asyncRoute(async (req, res) => {
  const months = Number(req.query.months || 6);
  const items = await repository.getMonthlyPatientSummary(req.user.sub, months);
  return res.json({ count: items.length, items });
}));

app.get("/api/summary/non-repeat-patients", authenticate, asyncRoute(async (req, res) => {
  const items = await repository.getNonRepeatPatients(req.user.sub);
  return res.json({ count: items.length, items });
}));

app.post(
  "/api/patients/:patientId/appointments",
  authenticate,
  upload.array("reports", 6),
  asyncRoute(async (req, res) => {
    const result = await appointmentHandlers.create({
      user: req.user,
      patientId: req.params.patientId,
      body: req.body || {},
      reports: mapUploadedFiles(req.files || []),
      idempotencyKey: getIdempotencyKey(req)
    });
    return sendApiResult(res, result);
  })
);

app.put(
  "/api/patients/:patientId/appointments/:appointmentId",
  authenticate,
  upload.array("reports", 6),
  asyncRoute(async (req, res) => {
    const result = await appointmentHandlers.updateLatest({
      user: req.user,
      patientId: req.params.patientId,
      appointmentId: req.params.appointmentId,
      body: req.body || {},
      reports: mapUploadedFiles(req.files || [])
    });
    return sendApiResult(res, result);
  })
);

app.get("/api/patients/:patientId/cases", authenticate, asyncRoute(async (req, res) => {
  const result = await patientHandlers.listAppointments({
    user: req.user,
    patientId: req.params.patientId,
    query: req.query || {}
  });
  return sendApiResult(res, result);
}));

app.post(
  "/api/patients/:patientId/cases",
  authenticate,
  upload.array("reports", 6),
  asyncRoute(async (req, res) => {
    const result = await appointmentHandlers.create({
      user: req.user,
      patientId: req.params.patientId,
      body: req.body || {},
      reports: mapUploadedFiles(req.files || []),
      idempotencyKey: getIdempotencyKey(req)
    });
    return sendApiResult(res, result);
  })
);

app.post(
  "/api/patients/:patientId/cases/:caseId/appointments",
  authenticate,
  upload.array("reports", 6),
  asyncRoute(async (req, res) => {
    const result = await appointmentHandlers.create({
      user: req.user,
      patientId: req.params.patientId,
      body: req.body || {},
      reports: mapUploadedFiles(req.files || []),
      idempotencyKey: getIdempotencyKey(req)
    });
    return sendApiResult(res, result);
  })
);

app.use("/api", (_req, res) => {
  return res.status(404).json({ message: "API route not found" });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled API error", err);
  if (res.headersSent) return;
  const status = Number(err?.statusCode || err?.status || 500);
  if (status >= 400 && status < 500) {
    const clientMessage = err?.type === "entity.parse.failed"
      ? "Invalid JSON payload"
      : (err?.message || "Bad request");
    return res.status(status).json({ message: clientMessage });
  }
  return res.status(500).json({ message: "Unexpected server error" });
});


export { app };
