-- Mentoral dashboard — run in Supabase SQL Editor (once per project).
-- Then paste URL + anon key into config.js (from config.example.js).

create table if not exists public.mentoral_settings (
  id int primary key default 1,
  constraint mentoral_settings_singleton check (id = 1),
  classes text[] not null default array['Class Alpha', 'Class Beta', 'Class Gamma']::text[],
  batches text[] not null default array['Batch 1', 'Batch 2']::text[],
  paaths text[] not null default array['Paath A', 'Paath B']::text[],
  batches_by_class jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.mentoral_settings (id, classes, batches, paaths, batches_by_class)
values (1,
  array['Class Alpha', 'Class Beta', 'Class Gamma'],
  array['Batch 1', 'Batch 2'],
  array['Paath A', 'Paath B'],
  '{"Class Alpha": ["Batch 1", "Batch 2", "Batch 3"]}'::jsonb
)
on conflict (id) do nothing;

-- Existing projects: add column if missing
alter table public.mentoral_settings
  add column if not exists batches_by_class jsonb not null default '{}'::jsonb;

create table if not exists public.mentoral_students (
  id bigserial primary key,
  external_id text not null unique,
  full_name text not null,
  student_email text default '',
  enrollment_ref text default '',
  guardian_name text default '',
  guardian_email text default '',
  guardian_phone text default '',
  class_name text not null default '',
  batch_name text not null default '',
  paath_name text not null default '',
  latest_score int not null default 0,
  latest_attempt_date date,
  attempts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists mentoral_students_class_idx on public.mentoral_students (class_name);
create index if not exists mentoral_students_paath_idx on public.mentoral_students (paath_name);

alter table public.mentoral_settings enable row level security;
alter table public.mentoral_students enable row level security;

-- Demo / development: open access with anon key.
-- Tighten before production (auth.uid(), service role, etc.).
create policy "mentoral_settings_read" on public.mentoral_settings
  for select using (true);
create policy "mentoral_settings_write" on public.mentoral_settings
  for insert with check (true);
create policy "mentoral_settings_update" on public.mentoral_settings
  for update using (true) with check (true);

create policy "mentoral_students_read" on public.mentoral_students
  for select using (true);
create policy "mentoral_students_insert" on public.mentoral_students
  for insert with check (true);
create policy "mentoral_students_update" on public.mentoral_students
  for update using (true) with check (true);
create policy "mentoral_students_delete" on public.mentoral_students
  for delete using (true);
