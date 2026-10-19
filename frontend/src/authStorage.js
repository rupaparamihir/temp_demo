const AUTH_STORAGE_KEY = "clinicAuth";

export function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeAuth(auth) {
  try {
    if (!auth || !auth.token) return;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Ignore storage failures (private mode/quota issues).
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

