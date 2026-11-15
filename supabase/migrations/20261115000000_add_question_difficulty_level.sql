-- Add quiz classification metadata to questions.
-- Safe to apply to an existing database; existing rows receive defaults.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'Easy',
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'Foundation';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_difficulty_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_difficulty_check
      CHECK (difficulty IN ('Easy', 'Medium', 'Hard'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_level_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_level_check
      CHECK (level IN ('Foundation', 'Intermediate', 'Advanced'));
  END IF;
END $$;
