-- Suplementos como parte del plan: sugerencias aceptadas o descartadas por la
-- persona, y registro diario de tomas.
ALTER TABLE "profiles" ADD COLUMN "supplement_choices" JSONB;
CREATE TABLE "supplement_logs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "supplement" TEXT NOT NULL,
  "taken" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplement_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplement_logs_user_id_date_supplement_key" ON "supplement_logs"("user_id", "date", "supplement");
CREATE INDEX "supplement_logs_user_id_date_idx" ON "supplement_logs"("user_id", "date");
ALTER TABLE "supplement_logs" ADD CONSTRAINT "supplement_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
