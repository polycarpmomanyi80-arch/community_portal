-- Run this migration in the Supabase SQL Editor to enable administrator reply threads.

create table if not exists public.report_messages (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.reports (id) on delete cascade,
    message text not null,
    responded_by uuid references auth.users (id) on delete set null default auth.uid(),
    created_at timestamptz not null default now(),
    constraint report_messages_text_length check (char_length(btrim(message)) between 1 and 5000)
);

create index if not exists report_messages_report_created_at_idx
    on public.report_messages (report_id, created_at);

alter table public.report_messages enable row level security;

drop policy if exists "Signed-in users can read report messages" on public.report_messages;
create policy "Signed-in users can read report messages"
on public.report_messages for select
to authenticated
using (true);

drop policy if exists "Admins can reply to reports" on public.report_messages;
create policy "Admins can reply to reports"
on public.report_messages for insert
to authenticated
with check (
    responded_by = (select auth.uid())
    and exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

revoke all on public.report_messages from public, anon, authenticated;
grant select, insert on public.report_messages to authenticated;

-- After registering the administrator, grant access if the project uses
-- the composite (user_id, admin_user) admin_users table:
-- insert into public.admin_users (user_id, admin_user)
-- select u.id, 1
-- from auth.users u
-- join public.profiles p on p.id = u.id
-- where lower(u.email) = 'poycarpmomanyi80@gmail.com'
--   and p.id_no = '778598281'
-- on conflict (user_id, admin_user) do nothing;
