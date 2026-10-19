import { config } from "../config.node.js";
import * as sqliteRepository from "../data.js";
import { createDbAdapter } from "./adapter.js";

function getRepository() {
  if (config.dbProvider === "d1") {
    throw new Error("DB_PROVIDER=d1 is supported only in Worker runtime.");
  }
  if (config.dbProvider === "sqlite") {
    return createDbAdapter("sqlite", sqliteRepository);
  }
  throw new Error(`Unsupported DB_PROVIDER: ${config.dbProvider}`);
}

export const repository = getRepository();
