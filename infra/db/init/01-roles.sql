-- Cluster and database roles — DATABASE.md §8.1.
--
-- Runs once, on the first boot of an empty postgres volume, as the superuser
-- created by the image (POSTGRES_USER=spm). Mounted read-only at
-- /docker-entrypoint-initdb.d by docker-compose (ARCHITECTURE.md §14.2).
--
-- Passwords come from the environment (ARCHITECTURE.md §14.2: "consumed by
-- db/init/01-roles.sql") and never appear in the repository. psql's \getenv
-- (PostgreSQL 15+, so it is available on postgres:17) reads them, and \gexec
-- builds the statements server-side, so no password is interpolated by a shell.
--
-- DATABASE.md §8.1 creates the database as `CREATE DATABASE spm OWNER
-- spm_migrator`. Under the official image the database already exists by the
-- time init scripts run (POSTGRES_DB=spm), and ALTER DATABASE ... OWNER would
-- require spm_migrator to have CREATEDB, which §8.1 forbids. So the equivalent
-- ownership is granted explicitly: spm_migrator gets CREATE on the database and
-- owns schema public; spm_app gets USAGE only. This is the documented deviation
-- for the containerised first boot, and it is flagged in the Step 8 PR.

\set ON_ERROR_STOP on

\getenv migrator_password MIGRATOR_PASSWORD
\getenv app_password APP_DB_PASSWORD

\if :{?migrator_password}
\else
  \echo 'MIGRATOR_PASSWORD is not set — refusing to create roles.'
  \quit 1
\endif

\if :{?app_password}
\else
  \echo 'APP_DB_PASSWORD is not set — refusing to create roles.'
  \quit 1
\endif

-- Two roles, exactly as DATABASE.md §8.1: login only, no superuser, no CREATEDB,
-- no CREATEROLE. Idempotent so a re-run on an existing cluster is a no-op.
SELECT format(
         'CREATE ROLE spm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
         :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spm_migrator')
\gexec

SELECT format(
         'CREATE ROLE spm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
         :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spm_app')
\gexec

-- Schema ownership (DATABASE.md §8: "spm_migrator owns every object ... the
-- application must never own a table"; §8.2 grants spm_app USAGE, not CREATE).
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO spm_migrator', current_database())
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO spm_migrator;
GRANT USAGE ON SCHEMA public TO spm_app;

-- Table/sequence grants (DATABASE.md §8.2) and the DELETE/UPDATE revokes (§8.3)
-- run after the first migration exists, in the deployment step. They are not
-- part of this first-boot script because no application tables exist yet.
