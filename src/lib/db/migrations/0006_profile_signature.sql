-- Add signature storage to profiles
ALTER TABLE "profiles" ADD COLUMN "signature_data_url" text;
