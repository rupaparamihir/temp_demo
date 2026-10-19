import { createDbAdapter } from "./adapter.js";
import { createD1Repository } from "./d1Repo.js";

function getD1Binding(env = {}) {
  return env.DB || env.D1_DB || env.CLINIC_DB || null;
}

export function getWorkerRepository(config, env = {}, executionCtx = null) {
  if (config?.dbProvider !== "d1") {
    throw new Error("Worker runtime supports DB_PROVIDER=d1 only");
  }
  const db = getD1Binding(env);
  if (!db) {
    throw new Error("Missing D1 binding. Configure env.DB (or D1_DB/CLINIC_DB).");
  }
  const deferTask = (task) => {
    if (executionCtx && typeof executionCtx.waitUntil === "function") {
      executionCtx.waitUntil(Promise.resolve(task).catch(() => {}));
    }
  };
  return createDbAdapter("d1", createD1Repository(db, config, { deferTask }));
}
