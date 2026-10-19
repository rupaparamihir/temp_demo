import { repositoryContract } from "./repository.js";

const REQUIRED_METHODS = Object.keys(repositoryContract);

function missingMethods(adapter = {}) {
  return REQUIRED_METHODS.filter((methodName) => typeof adapter[methodName] !== "function");
}

export function assertDbAdapter(adapter, adapterName = "unknown") {
  const missing = missingMethods(adapter);
  if (missing.length > 0) {
    throw new Error(
      `DB adapter "${adapterName}" is missing required methods: ${missing.join(", ")}`
    );
  }
}

export function createDbAdapter(adapterName, adapterImpl) {
  assertDbAdapter(adapterImpl, adapterName);
  return Object.freeze({ ...adapterImpl });
}

export function listRequiredDbAdapterMethods() {
  return [...REQUIRED_METHODS];
}
