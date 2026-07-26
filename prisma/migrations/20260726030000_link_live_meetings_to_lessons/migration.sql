CREATE TYPE "MeetingPlatform" AS ENUM ('GOOGLE_MEET', 'ZOOM', 'MICROSOFT_TEAMS', 'OTHER');

ALTER TABLE "class_meetings"
ADD COLUMN "lesson_id" INTEGER,
ADD COLUMN "platform" "MeetingPlatform" NOT NULL DEFAULT 'OTHER';

UPDATE "class_meetings" cm
SET "platform" = CASE
  WHEN lower(coalesce(ts."platform", '')) LIKE '%google%' OR lower(cm."private_meeting_url") LIKE '%meet.google%' THEN 'GOOGLE_MEET'::"MeetingPlatform"
  WHEN lower(coalesce(ts."platform", '')) LIKE '%zoom%' OR lower(cm."private_meeting_url") LIKE '%zoom%' THEN 'ZOOM'::"MeetingPlatform"
  WHEN lower(coalesce(ts."platform", '')) LIKE '%teams%' OR lower(cm."private_meeting_url") LIKE '%teams%' THEN 'MICROSOFT_TEAMS'::"MeetingPlatform"
  ELSE 'OTHER'::"MeetingPlatform"
END
FROM "training_sessions" ts
WHERE cm."training_session_id" = ts."id";

CREATE INDEX "class_meetings_lesson_id_idx" ON "class_meetings"("lesson_id");
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_lesson_id_fkey"
FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
