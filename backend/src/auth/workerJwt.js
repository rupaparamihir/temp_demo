import { createWorkerAuth } from "../auth.worker.js";

export async function signWorkerToken(clinic, sessionId, config) {
  const auth = createWorkerAuth(config);
  return auth.signToken(clinic, sessionId);
}
