// Chiffrement des clés API utilisateur au repos (table user_api_keys).
// AES-256-GCM : authentifié (détecte toute altération du ciphertext, contre
// pgcrypto qui aurait demandé une fonction SQL + gestion du secret côté DB —
// ici le secret ne quitte jamais l'environnement serveur Node).
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // recommandé pour GCM

function getKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET manquante ou invalide (attendu : 64 caractères hexadécimaux / 32 octets).",
    );
  }
  return Buffer.from(hex, "hex");
}

// Format de sortie : base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Format de clé chiffrée invalide.");
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
