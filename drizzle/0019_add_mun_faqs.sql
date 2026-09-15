CREATE TABLE IF NOT EXISTS "mun_faqs" (
  "id" text PRIMARY KEY NOT NULL,
  "mun_id" text NOT NULL REFERENCES "muns"("id") ON DELETE CASCADE,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mun_faqs_mun_id_idx" ON "mun_faqs" USING btree ("mun_id");