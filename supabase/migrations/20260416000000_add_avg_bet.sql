-- Add avg_bet_amount column to devices table
ALTER TABLE "public"."devices" ADD COLUMN IF NOT EXISTS "avg_bet_amount" numeric DEFAULT 0 NOT NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_devices_avg_bet ON "public"."devices" ("device_id", "avg_bet_amount");
