#!/usr/bin/env node
/**
 * Set a user's password directly against the database.
 *
 * There is no password-reset endpoint, and the admin API needs a login you can
 * only get by knowing the password already — so this is the recovery path when
 * an account is locked out.
 *
 * Usage (run it where the database lives):
 *   node scripts/set-password.mjs <email>
 *
 * The password is read from the terminal with echo off and is never taken as an
 * argument, so it stays out of shell history, `ps` output, and any logs. Uses the
 * same scrypt parameters as src/auth.ts, so the server verifies it unchanged.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';
import process from 'node:process';
import Database from 'better-sqlite3';

const SCRYPT_KEYLEN = 64; // must match SCRYPT_KEYLEN in src/auth.ts
const MIN_LENGTH = 8;

const email = process.argv[2];
const dbPath = process.env.DATABASE_PATH || './data/diss.db';

if (!email) {
  console.error('usage: node scripts/set-password.mjs <email>');
  process.exit(2);
}

/** Read a line from the TTY without echoing it. */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('needs an interactive terminal (run it without piping stdin)'));
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = char => {
      // Re-print the prompt with the typed characters swallowed.
      if (!['\n', '\r', ''].includes(char.toString())) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(prompt);
      }
    };
    process.stdin.on('data', onData);
    rl.question(prompt, answer => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const db = new Database(dbPath);
const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
if (!user) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  console.error(`No account with that email. The database has ${count} user(s).`);
  process.exit(1);
}

console.log(`Setting a new password for ${user.name} <${user.email}>`);
const password = await askHidden('New password: ');
const again = await askHidden('Confirm password: ');

if (password !== again) {
  console.error('Passwords did not match — nothing changed.');
  process.exit(1);
}
if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters — nothing changed.`);
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);

// Existing sessions were issued against the old password; drop them so a stolen
// or stale session can't outlive the reset.
const dropped = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
console.log(`Password updated. ${dropped} existing session(s) signed out.`);
