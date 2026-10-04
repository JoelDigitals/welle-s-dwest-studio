// Notfall-Zugang: legt einen Studio-Account an oder setzt sein Passwort neu – direkt in der
// Datenbank, ohne dass jemand eingeloggt sein muss (z. B. wenn alle Passwörter vergessen sind).
// Im Studio selbst geht das bequemer unter dem Reiter "Konten".
//
//   node --env-file=.env scripts/set-password.mjs <nutzername> [anzeigename]
//
// Das Passwort wird danach abgefragt (oder per Umgebungsvariable NEW_PASSWORD übergeben) und im
// selben Format wie src/lib/server/password.ts gespeichert.
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

const [usernameArg, displayNameArg] = process.argv.slice(2);
if (!usernameArg) {
  console.error("Aufruf: node --env-file=.env scripts/set-password.mjs <nutzername> [anzeigename]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL fehlt (mit --env-file=.env starten).");
  process.exit(1);
}

const username = usernameArg.trim().toLowerCase();
let password = process.env.NEW_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question(`Neues Passwort für "${username}": `);
  rl.close();
}
if (!password || password.length < 8) {
  console.error("Passwort muss mindestens 8 Zeichen haben.");
  process.exit(1);
}

const N = 16384;
const R = 8;
const P = 1;
const salt = randomBytes(16);
const derived = await new Promise((resolve, reject) =>
  scrypt(password, salt, 64, { N, r: R, p: P }, (err, key) => (err ? reject(err) : resolve(key))),
);
const passwordHash = `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${derived.toString("hex")}`;

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  ssl: "require",
  onnotice: () => {},
});
try {
  const updated = await sql`
    UPDATE users SET password_hash = ${passwordHash} WHERE username = ${username} RETURNING id
  `;
  if (updated.length > 0) {
    console.log(`Passwort für "${username}" neu gesetzt.`);
  } else {
    await sql`
      INSERT INTO users (id, username, password_hash, display_name, host_id, created_at)
      VALUES (${randomUUID()}, ${username}, ${passwordHash}, ${displayNameArg ?? usernameArg}, ${null}, ${Date.now()})
    `;
    console.log(`Neuer Account "${username}" angelegt.`);
  }
} finally {
  await sql.end();
}
