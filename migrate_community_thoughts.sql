-- Run this migration in the Supabase SQL Editor to enable Fire/Theft reports
-- and resident-submitted thoughts in an existing project.

alter table public.reports
    drop constraint if exists reports_category_check;

alter table public.reports
    add constraint reports_category_check
    check (
        category in (
            'Roads & Traffic',
            'Water & Sewage',
            'Garbage & Sanitation',
            'Electricity & Power',
            'Public Safety',
            'Fire',
            'Theft'
        )
    );

create table if not exists public.community_thoughts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
    thought text not null,
    created_at timestamptz not null default now(),
    constraint community_thoughts_text_length check (char_length(btrim(thought)) between 1 and 3000)
);

create index if not exists community_thoughts_created_at_idx
    on public.community_thoughts (created_at desc);

alter table public.community_thoughts enable row level security;

drop policy if exists "Signed-in users can read community thoughts" on public.community_thoughts;
create policy "Signed-in users can read community thoughts"
on public.community_thoughts for select
to authenticated
using (true);

drop policy if exists "Residents can share their own thoughts" on public.community_thoughts;
create policy "Residents can share their own thoughts"
on public.community_thoughts for insert
to authenticated
with check (user_id = (select auth.uid()));

revoke all on public.community_thoughts from public, anon, authenticated;
grant select, insert on public.community_thoughts to authenticated;
