# KnowVa database scripts

This folder contains **PostgreSQL** SQL files. They are not a separate database server; configure PostgreSQL in `backend/.env` using `DATABASE_URL`.

| File | Description |
| --- | --- |
| `01_schema.sql` | Backend-compatible database schema. Intended for a new **empty** database. |
| `02_sample_data_optional.sql` | Optional placeholder team accounts and fictional research examples. |
| `USER_SUPPLIED_knowva_database.sql` | Exact user-provided SQL seed script from the upload, retained for reference. |

## Initialization

From the `backend/` folder, run `npm run db:init` **only for a new empty database**. The script reads `../database/01_schema.sql` automatically. To load optional example data after schema initialization, follow the instructions in the root README. Avoid importing both seed files, as they overlap.

**Existing database:** back up your existing `publication_system` first. Do not run the new schema or seeds against it until tables, enum types, columns, and constraints have been compared and a migration has been reviewed. The uploaded user SQL is sample/seed content, not a complete `CREATE TABLE` database schema.
