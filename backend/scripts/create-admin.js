
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const displayName = String(process.env.ADMIN_NAME || 'Admin').trim();
const password = process.env.ADMIN_PASSWORD;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Enter a valid administrator email.');
}

if (!password || password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)) {
  throw new Error('Password must have 12+ characters, uppercase, lowercase, and numbers.');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing.');
}

const names = displayName.split(/\s+/);
const firstName = names.length > 1
  ? names.slice(0, -1).join(' ')
  : names[0];
const lastName = names.length > 1 ? names.at(-1) : '';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

try {
  await client.connect();
  await client.query('BEGIN');

  const existing = (await client.query(
    'SELECT user_id, role FROM users WHERE lower(email) = $1 FOR UPDATE',
    [email]
  )).rows[0];

  if (existing && existing.role !== 'ADMIN') {
    throw new Error('Email belongs to a non-admin account. Use a different email or review the account before promotion.');
  }

  const hash = await bcrypt.hash(password, 12);

  if (existing) {
    await client.query(
      `UPDATE users SET
        first_name = $1,
        last_name = $2,
        password_hash = $3,
        role = 'ADMIN',
        active = true,
        email_verified = true,
        updated_at = NOW()
       WHERE user_id = $4`,
      [firstName, lastName, hash, existing.user_id]
    );
  } else {
    await client.query(
      `INSERT INTO users
       (first_name, last_name, email, password_hash,
        role, department, student_number, active, email_verified)
       VALUES ($1, $2, $3, $4, 'ADMIN',
               'Research Administration', NULL, true, true)`,
      [firstName, lastName, email, hash]
    );
  }

  await client.query('COMMIT');
  console.log('Administrator account ready.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
