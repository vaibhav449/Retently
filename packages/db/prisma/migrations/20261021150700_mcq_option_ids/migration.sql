-- C-3 (proposal): stable MCQ option ids. items is Anurag's table; this migration is part of a
-- proposal for review and can be dropped on its own.
--
-- Written by hand. `prisma migrate diff` drops and re-adds "options", which loses every option and
-- fails on a non-empty table because the new column is NOT NULL. Instead, each existing option
-- becomes {"id","text"} with a fresh id, in the same order, and answer_option_id points at the
-- option whose text is the answer.

ALTER TABLE "items" ADD COLUMN "answer_option_id" UUID;
ALTER TABLE "items" ADD COLUMN "options_with_ids" JSONB NOT NULL DEFAULT '[]';

UPDATE "items" SET "options_with_ids" = COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', o.label) ORDER BY o.ord)
     FROM unnest("items"."options") WITH ORDINALITY AS o(label, ord)),
    '[]'::jsonb);

UPDATE "items" SET "answer_option_id" = (
    SELECT (o->>'id')::uuid
    FROM jsonb_array_elements("items"."options_with_ids") AS o
    WHERE o->>'text' = "items"."answer")
WHERE "type" = 'mcq';

ALTER TABLE "items" DROP COLUMN "options";
ALTER TABLE "items" RENAME COLUMN "options_with_ids" TO "options";
ALTER TABLE "items" ALTER COLUMN "options" DROP DEFAULT;
