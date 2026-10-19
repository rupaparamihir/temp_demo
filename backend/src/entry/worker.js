import { createAuthHandlers } from "../app/handlers/authHandlers.js";
import { createPatientHandlers } from "../app/handlers/patientHandlers.js";
import { createAppointmentHandlers } from "../app/handlers/appointmentHandlers.js";
import { getWorkerRepository } from "../db/index.worker.js";
import { createWorkerConfig } from "../config.worker.js";
import { createWorkerAuth } from "../auth.worker.js";

let repositoryInitPromise = null;
const unauthIpMinuteCounters = new Map();

function getApiCacheHeaders() {
  return {
    "cache-control": "no-store",
    pragma: "no-cache",
    expires: "0"
  };
}

function getCorsHeaders(config, request) {
  const requestOrigin = String(request.headers.get("origin") || "").trim();
  const explicitOrigin = String(config?.corsOrigin || "").trim();
  const sameOrigin = (() => {
    if (!requestOrigin) return "";
    try {
      return requestOrigin === new URL(request.url).origin ? requestOrigin : "";
    } catch {
      return "";
    }
  })();
  const allowOrigin = explicitOrigin || sameOrigin;
  if (!allowOrigin) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, content-type, idempotency-key, x-request-id",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    vary: "Origin"
  };
}

function json(status, body, config, request, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...getApiCacheHeaders(),
      ...getCorsHeaders(config, request),
      ...headers
    }
  });
}

function getRequestIp(request) {
  const cfIp = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for") || "";
  const ip = String(fwd).split(",")[0].trim();
  return ip || "unknown";
}

function getRetryAfterSecondsForMinute(now = Date.now()) {
  const msLeft = 60000 - (now % 60000);
  return Math.max(1, Math.ceil(msLeft / 1000));
}

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

function getRouteKey(path, fallback = "unknown") {
  if (!path) return fallback;
  return String(path).slice(0, 120);
}

async function parseBody(request) {
  const type = request.headers.get("content-type") || "";
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("application/json")) {
    try {
      return { body: await request.json(), reports: [] };
    } catch (err) {
      const e = new Error("Invalid JSON payload");
      e.status = 400;
      e.cause = err;
      throw e;
    }
  }
  if (normalizedType.includes("multipart/form-data")) {
    const form = await request.formData();
    const body = {};
    const reports = [];
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if (key === "reports" && value.size > 0) {
          reports.push({
            name: value.name || "report",
            mimeType: value.type || "application/octet-stream",
            size: Number(value.size || 0),
            // Worker runtime currently does not persist file blobs;
            // keep route compatibility by preserving metadata only.
            url: ""
          });
        }
        continue;
      }
      body[key] = String(value ?? "");
    }
    return { body, reports };
  }
  return { body: {}, reports: [] };
}

async function getUserFromRequest(request, workerAuth) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  return workerAuth.verifyToken(token);
}

function getIdempotencyKey(request) {
  return String(request.headers.get("idempotency-key") || "").trim();
}

export default {
  async fetch(request, env, ctx) {
    const config = createWorkerConfig(env);
    const startedAt = Date.now();
    const requestId = String(request.headers.get("x-request-id") || "").trim()
      || (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`);
    const url = new URL(request.url);
    const path = url.pathname;

    let repository = null;
    const respond = (status, body, headers = {}, meta = {}) => {
      const out = json(
        status,
        body,
        config,
        request,
        {
          ...headers,
          "x-request-id": requestId
        }
      );
      if (repository && typeof repository.recordRequestMetric === "function") {
        const task = Promise.resolve(
          repository.recordRequestMetric({
            requestId,
            route: getRouteKey(meta.route || path),
            clinicId: Math.max(0, Number(meta.clinicId || 0)),
            statusCode: Math.max(0, Number(status) || 0),
            latencyMs: Math.max(0, Date.now() - startedAt),
            createdAt: Date.now()
          })
        ).catch(() => {});
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(task);
        }
      }
      return out;
    };

    const enforceUnauthGlobalLimit = (routeKey) => {
      const ip = getRequestIp(request);
      const current = incrementUnauthIpCounter(ip);
      if (current <= config.maxUnauthRequestsPerIpPerMinute) return null;
      return respond(
        429,
        {
          message: `Too many unauthenticated requests from this IP (${config.maxUnauthRequestsPerIpPerMinute}/minute)`
        },
        { "Retry-After": String(getRetryAfterSecondsForMinute()) },
        { route: routeKey, clinicId: 0 }
      );
    };

    if (request.method === "OPTIONS") {
      return new Response(
        null,
        {
          status: 204,
          headers: {
            ...getApiCacheHeaders(),
            ...getCorsHeaders(config, request),
            "x-request-id": requestId
          }
        }
      );
    }

    try {
      repository = getWorkerRepository(config, env, ctx);
      if (!repositoryInitPromise) {
        repositoryInitPromise = repository.initDataStore();
      }
      await repositoryInitPromise;
    } catch (err) {
      repositoryInitPromise = null;
      return respond(500, { message: err?.message || "Worker repository initialization failed" }, {}, { route: path, clinicId: 0 });
    }
    const workerAuth = createWorkerAuth(config);
    const authHandlers = createAuthHandlers({
      repository,
      config,
      signToken: (clinic, sessionId) => workerAuth.signToken(clinic, sessionId),
      randomUUID: () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`
    });
    const patientHandlers = createPatientHandlers({ repository, config });
    const appointmentHandlers = createAppointmentHandlers({ repository, config });

    if (request.method === "GET" && path === "/api/health") {
      return respond(200, { ok: true }, {}, { route: "/api/health", clinicId: 0 });
    }

    if (request.method === "POST" && path === "/api/auth/register") {
      const limited = enforceUnauthGlobalLimit("/api/auth/register");
      if (limited) return limited;
      try {
        const payload = await parseBody(request);
        const result = await authHandlers.register({
          body: payload.body,
          ip: getRequestIp(request),
          idempotencyKey: getIdempotencyKey(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/register", clinicId: 0 });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/auth/register", clinicId: 0 });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/auth/register", clinicId: 0 });
      }
    }

    if (request.method === "POST" && path === "/api/auth/login") {
      const limited = enforceUnauthGlobalLimit("/api/auth/login");
      if (limited) return limited;
      try {
        const payload = await parseBody(request);
        const result = await authHandlers.login({
          body: payload.body,
          ip: getRequestIp(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/login", clinicId: 0 });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/auth/login", clinicId: 0 });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/auth/login", clinicId: 0 });
      }
    }

    if (request.method === "POST" && path === "/api/auth/reset-password") {
      const limited = enforceUnauthGlobalLimit("/api/auth/reset-password");
      if (limited) return limited;
      try {
        const payload = await parseBody(request);
        const result = await authHandlers.resetPassword({
          body: payload.body
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/reset-password", clinicId: 0 });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/auth/reset-password", clinicId: 0 });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/auth/reset-password", clinicId: 0 });
      }
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/auth/me", clinicId: 0 });
      const result = await authHandlers.me({ user });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/me", clinicId: user.sub });
    }

    if (request.method === "POST" && path === "/api/auth/ping") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/auth/ping", clinicId: 0 });
      const result = await authHandlers.ping({ user });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/ping", clinicId: user.sub });
    }

    if (request.method === "POST" && path === "/api/auth/logout") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/auth/logout", clinicId: 0 });
      const result = await authHandlers.logout({
        user,
        ip: getRequestIp(request)
      });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/auth/logout", clinicId: user.sub });
    }

    if (request.method === "POST" && path === "/api/patients") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients", clinicId: 0 });
      try {
        const payload = await parseBody(request);
        const result = await patientHandlers.create({
          user,
          body: payload.body,
          reports: payload.reports,
          idempotencyKey: getIdempotencyKey(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients", clinicId: user.sub });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/patients", clinicId: user.sub });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/patients", clinicId: user.sub });
      }
    }

    if (request.method === "GET" && path === "/api/patients/search") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/search", clinicId: 0 });
      const result = await patientHandlers.search({
        user,
        query: {
          firstName: url.searchParams.get("firstName") || "",
          lastName: url.searchParams.get("lastName") || "",
          phone: url.searchParams.get("phone") || "",
          page: url.searchParams.get("page") || "",
          pageSize: url.searchParams.get("pageSize") || "",
          cursor: url.searchParams.get("cursor") || ""
        }
      });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/search", clinicId: user.sub });
    }

    const appointmentsMatch = path.match(/^\/api\/patients\/([^/]+)\/appointments$/);
    if (appointmentsMatch && request.method === "GET") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/appointments", clinicId: 0 });
      const result = await patientHandlers.listAppointments({
        user,
        patientId: appointmentsMatch[1],
        query: {
          page: url.searchParams.get("page") || "",
          pageSize: url.searchParams.get("pageSize") || "",
          cursor: url.searchParams.get("cursor") || ""
        }
      });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/appointments", clinicId: user.sub });
    }

    if (appointmentsMatch && request.method === "POST") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/appointments", clinicId: 0 });
      try {
        const payload = await parseBody(request);
        const result = await appointmentHandlers.create({
          user,
          patientId: appointmentsMatch[1],
          body: payload.body,
          reports: payload.reports,
          idempotencyKey: getIdempotencyKey(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/appointments", clinicId: user.sub });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/patients/:patientId/appointments", clinicId: user.sub });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/patients/:patientId/appointments", clinicId: user.sub });
      }
    }

    const appointmentUpdateMatch = path.match(/^\/api\/patients\/([^/]+)\/appointments\/([^/]+)$/);
    if (appointmentUpdateMatch && request.method === "PUT") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/appointments/:appointmentId", clinicId: 0 });
      try {
        const payload = await parseBody(request);
        const result = await appointmentHandlers.updateLatest({
          user,
          patientId: appointmentUpdateMatch[1],
          appointmentId: appointmentUpdateMatch[2],
          body: payload.body,
          reports: payload.reports
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/appointments/:appointmentId", clinicId: user.sub });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/patients/:patientId/appointments/:appointmentId", clinicId: user.sub });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/patients/:patientId/appointments/:appointmentId", clinicId: user.sub });
      }
    }

    const casesMatch = path.match(/^\/api\/patients\/([^/]+)\/cases$/);
    if (casesMatch && request.method === "GET") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/cases", clinicId: 0 });
      const result = await patientHandlers.listAppointments({
        user,
        patientId: casesMatch[1],
        query: {
          page: url.searchParams.get("page") || "",
          pageSize: url.searchParams.get("pageSize") || "",
          cursor: url.searchParams.get("cursor") || ""
        }
      });
      return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/cases", clinicId: user.sub });
    }

    if (casesMatch && request.method === "POST") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/cases", clinicId: 0 });
      try {
        const payload = await parseBody(request);
        const result = await appointmentHandlers.create({
          user,
          patientId: casesMatch[1],
          body: payload.body,
          reports: payload.reports,
          idempotencyKey: getIdempotencyKey(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/cases", clinicId: user.sub });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/patients/:patientId/cases", clinicId: user.sub });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/patients/:patientId/cases", clinicId: user.sub });
      }
    }

    const caseAppointmentMatch = path.match(/^\/api\/patients\/([^/]+)\/cases\/([^/]+)\/appointments$/);
    if (caseAppointmentMatch && request.method === "POST") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/patients/:patientId/cases/:caseId/appointments", clinicId: 0 });
      try {
        const payload = await parseBody(request);
        const result = await appointmentHandlers.create({
          user,
          patientId: caseAppointmentMatch[1],
          body: payload.body,
          reports: payload.reports,
          idempotencyKey: getIdempotencyKey(request)
        });
        return respond(result.status || 200, result.body || {}, result.headers || {}, { route: "/api/patients/:patientId/cases/:caseId/appointments", clinicId: user.sub });
      } catch (err) {
        if (Number(err?.status) === 400) return respond(400, { message: "Invalid JSON payload" }, {}, { route: "/api/patients/:patientId/cases/:caseId/appointments", clinicId: user.sub });
        return respond(500, { message: "Unexpected server error" }, {}, { route: "/api/patients/:patientId/cases/:caseId/appointments", clinicId: user.sub });
      }
    }

    if (request.method === "GET" && path === "/api/summary/weekly-patients") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/summary/weekly-patients", clinicId: 0 });
      const weeks = Number(url.searchParams.get("weeks") || 4);
      const items = await repository.getWeeklyPatientSummary(user.sub, weeks);
      return respond(200, { count: items.length, items }, {}, { route: "/api/summary/weekly-patients", clinicId: user.sub });
    }

    if (request.method === "GET" && path === "/api/summary/monthly-patients") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/summary/monthly-patients", clinicId: 0 });
      const months = Number(url.searchParams.get("months") || 6);
      const items = await repository.getMonthlyPatientSummary(user.sub, months);
      return respond(200, { count: items.length, items }, {}, { route: "/api/summary/monthly-patients", clinicId: user.sub });
    }

    if (request.method === "GET" && path === "/api/summary/non-repeat-patients") {
      const user = await getUserFromRequest(request, workerAuth);
      if (!user) return respond(401, { message: "Invalid or expired token" }, {}, { route: "/api/summary/non-repeat-patients", clinicId: 0 });
      const items = await repository.getNonRepeatPatients(user.sub);
      return respond(200, { count: items.length, items }, {}, { route: "/api/summary/non-repeat-patients", clinicId: user.sub });
    }

    if (request.method === "GET" && path === "/api/debug/db-info") {
      const info = await repository.getDataStoreDebugInfo();
      return respond(200, info, {}, { route: "/api/debug/db-info", clinicId: 0 });
    }

    return respond(404, { message: "API route not found" }, {}, { route: path, clinicId: 0 });
  }
};
