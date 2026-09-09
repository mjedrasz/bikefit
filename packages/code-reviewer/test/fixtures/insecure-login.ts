import { db } from "./db.js";

/**
 * Sample target for the reviewer. This file intentionally contains defects:
 *  - SQL injection through string interpolation
 *  - plaintext password comparison
 *  - a predictable, non-expiring session token
 */
export async function login(username: string, password: string) {
  const rows = await db.query(
    `SELECT id, name, password FROM users WHERE name = '${username}' AND password = '${password}'`,
  );

  const user = rows[0];
  if (user && user.password == password) {
    return { userId: user.id, token: `session-${user.name}` };
  }

  return null;
}
