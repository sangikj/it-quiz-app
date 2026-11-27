-- Launch-ready features: quiz status compatibility, feedback, and opt-in leaderboard.
-- Safe to apply after the existing user quiz progress migration.

alter table public.quiz_attempts
  add column if not exists status text not null default 'completed'
  check (status in ('completed', 'ended'));

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  message text,
  created_at timestamptz not null default now(),
  constraint app_feedback_message_length check (message is null or char_length(message) <= 2000)
);

alter table public.app_feedback enable row level security;
grant select, insert on public.app_feedback to authenticated;

create policy "Users can read their own app feedback"
  on public.app_feedback for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can submit their own app feedback"
  on public.app_feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);

alter table public.profiles
  add column if not exists leaderboard_opt_in boolean not null default false;

-- Only users who explicitly opt in appear on the leaderboard.
create or replace function public.get_quiz_leaderboard(limit_count integer default 20)
returns table (
  rank bigint,
  display_name text,
  quizzes_completed bigint,
  total_correct bigint,
  total_questions bigint,
  average_score numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with scores as (
    select
      p.id,
      coalesce(nullif(btrim(p.display_name), ''), 'Quiz learner') as display_name,
      count(a.id)::bigint as quizzes_completed,
      coalesce(sum(a.correct_answers), 0)::bigint as total_correct,
      coalesce(sum(a.total_questions), 0)::bigint as total_questions,
      coalesce(round(avg(a.score_percentage), 2), 0)::numeric as average_score
    from public.profiles p
    join public.quiz_attempts a on a.user_id = p.id
    where p.leaderboard_opt_in = true
      and a.status = 'completed'
    group by p.id, p.display_name
    having count(a.id) > 0
  )
  select
    row_number() over (order by s.average_score desc, s.quizzes_completed desc, s.total_correct desc)::bigint,
    s.display_name,
    s.quizzes_completed,
    s.total_correct,
    s.total_questions,
    s.average_score
  from scores s
  order by s.average_score desc, s.quizzes_completed desc, s.total_correct desc
  limit greatest(1, least(coalesce(limit_count, 20), 100));
$$;

revoke all on function public.get_quiz_leaderboard(integer) from public, anon;
grant execute on function public.get_quiz_leaderboard(integer) to authenticated;
