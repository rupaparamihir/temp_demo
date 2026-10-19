import jwt from "jsonwebtoken";
import { config } from "./config.node.js";
import { repository } from "./db/index.node.js";

export async function signToken(clinic, sessionId = null) {
  return jwt.sign(
    {
      sub: clinic.id,
      clinicCode: clinic.clinicCode,
      clinicName: clinic.name
    },
    config.jwtSecret,
    {
      expiresIn: `${config.jwtTtlHours}h`,
      ...(sessionId ? { jwtid: sessionId } : {})
    }
  );
}

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const isSessionValid = await repository.validateSession(
      payload.sub,
      String(payload.jti || ""),
      Date.now()
    );
    if (!isSessionValid) {
      return res.status(401).json({ message: "Invalid session" });
    }
    const clinic = await repository.findClinicById(payload.sub);
    if (!clinic) {
      return res.status(401).json({ message: "Invalid session" });
    }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
