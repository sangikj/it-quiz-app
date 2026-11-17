create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track text,
  difficulty text check (difficulty in ('Easy','Medium','Hard') or difficulty is null),
  level text check (level in ('Foundation','Intermediate','Advanced') or level is null),
  mode text not null default 'timed' check (mode in ('timed','practice')),
  total_questions integer not null check (total_questions >= 0),
  correct_answers integer not null check (correct_answers >= 0 and correct_answers <= total_questions),
  score_percentage numeric(5,2) not null check (score_percentage >= 0 and score_percentage <= 100),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.quiz_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_index smallint,
  correct_index smallint not null check (correct_index >= 0 and correct_index <= 3),
  is_correct boolean not null,
  time_taken_seconds integer not null default 0 check (time_taken_seconds >= 0),
  answered_at timestamptz not null default now(),
  constraint quiz_responses_attempt_owner_fk
    foreign key (attempt_id, user_id)
    references public.quiz_attempts(id, user_id) on delete cascade,
  unique (attempt_id, question_id)
);

create table public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timer_enabled boolean not null default true,
  time_limit_seconds integer not null default 30 check (time_limit_seconds between 10 and 300),
  updated_at timestamptz not null default now()
);

create index quiz_attempts_user_completed_idx
  on public.quiz_attempts(user_id, completed_at desc);
create index quiz_responses_user_attempt_idx
  on public.quiz_responses(user_id, attempt_id);
create index quiz_responses_user_question_idx
  on public.quiz_responses(user_id, question_id);
create index bookmarks_question_idx
  on public.bookmarks(question_id);

alter table public.profiles enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_responses enable row level security;
alter table public.bookmarks enable row level security;
alter table public.user_preferences enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.quiz_attempts to authenticated;
grant select, insert, update, delete on public.quiz_responses to authenticated;
grant select, insert, delete on public.bookmarks to authenticated;
grant select, insert, update on public.user_preferences to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read their own quiz attempts"
  on public.quiz_attempts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own quiz attempts"
  on public.quiz_attempts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own quiz attempts"
  on public.quiz_attempts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own quiz attempts"
  on public.quiz_attempts for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own quiz responses"
  on public.quiz_responses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own quiz responses"
  on public.quiz_responses for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own quiz responses"
  on public.quiz_responses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own quiz responses"
  on public.quiz_responses for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own bookmarks"
  on public.bookmarks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can add their own bookmarks"
  on public.bookmarks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can remove their own bookmarks"
  on public.bookmarks for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own preferences"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own preferences"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own preferences"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_quiz_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_quiz_user() from public, anon, authenticated;

create trigger on_auth_user_created_quiz_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_quiz_user();