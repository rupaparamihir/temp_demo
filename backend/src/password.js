function getCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error("WebCrypto API is not available in this runtime");
}

let nodeCryptoModulePromise = null;

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process?.versions?.node);
}

async function getNodeCryptoModule() {
  if (!isNodeRuntime()) return null;
  if (!nodeCryptoModulePromise) {
    nodeCryptoModulePromise = import("node:crypto");
  }
  return nodeCryptoModulePromise;
}

function toBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derivePbkdf2Sha256(password, saltBytes, iterations) {
  if (isNodeRuntime()) {
    const nodeCrypto = await getNodeCryptoModule();
    if (nodeCrypto?.pbkdf2) {
      const pass = Buffer.from(String(password || ""), "utf8");
      const salt = Buffer.from(saltBytes);
      const hash = await new Promise((resolve, reject) => {
        nodeCrypto.pbkdf2(pass, salt, iterations, 32, "sha256", (err, derived) => {
          if (err) return reject(err);
          resolve(derived);
        });
      });
      return new Uint8Array(hash);
    }
  }
  const cryptoImpl = getCrypto();
  const enc = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    enc.encode(String(password || "")),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await cryptoImpl.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations
    },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = 10000) {
  let salt;
  if (isNodeRuntime()) {
    const nodeCrypto = await getNodeCryptoModule();
    if (nodeCrypto?.randomBytes) {
      salt = new Uint8Array(nodeCrypto.randomBytes(16));
    }
  }
  if (!salt) {
    const cryptoImpl = getCrypto();
    salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  }
  const hash = await derivePbkdf2Sha256(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const value = String(stored || "");
  const parts = value.split("$");
  if (parts.length !== 5) return false;
  const [scheme, algo, iterRaw, saltB64, hashB64] = parts;
  if (scheme !== "pbkdf2" || algo !== "sha256") return false;
  const iterations = Number(iterRaw);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = await derivePbkdf2Sha256(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}
