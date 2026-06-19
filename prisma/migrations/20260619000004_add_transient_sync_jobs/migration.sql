CREATE TABLE "transient_sync_jobs" (
  "id"            SERIAL PRIMARY KEY,
  "geminiJobName" VARCHAR(500) NOT NULL,
  "status"        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  "airportsJson"  TEXT         NOT NULL,
  "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "transient_sync_jobs_status_idx" ON "transient_sync_jobs" ("status");
