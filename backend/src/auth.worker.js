function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(base64url) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(`${b64}${pad}`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeJson(value) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(base64url) {
  const bytes = fromBase64Url(base64url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

export function createWorkerAuth(config) {
  return {
    async signToken(clinic, sessionId = null) {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + (Number(config.jwtTtlHours || 8) * 60 * 60);
      const header = { alg: "HS256", typ: "JWT" };
      const payload = {
        sub: clinic.id,
        clinicCode: clinic.clinicCode,
        clinicName: clinic.name,
        iat: now,
        exp,
        ...(sessionId ? { jti: sessionId } : {})
      };
      const encodedHeader = encodeJson(header);
      const encodedPayload = encodeJson(payload);
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const key = await importHmacKey(String(config.jwtSecret || ""), ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
      const signature = toBase64Url(new Uint8Array(sig));
      return `${signingInput}.${signature}`;
    },

    async verifyToken(token) {
      const raw = String(token || "");
      const parts = raw.split(".");
      if (parts.length !== 3) return null;
      const [h, p, s] = parts;
      const signingInput = `${h}.${p}`;
      const key = await importHmacKey(String(config.jwtSecret || ""), ["verify"]);
      const isValid = await crypto.subtle.verify(
        "HMAC",
        key,
        fromBase64Url(s),
        new TextEncoder().encode(signingInput)
      );
      if (!isValid) return null;
      const payload = decodeJson(p);
      const now = Math.floor(Date.now() / 1000);
      if (Number(payload?.exp || 0) <= now) return null;
      return payload;
    }
  };
}
