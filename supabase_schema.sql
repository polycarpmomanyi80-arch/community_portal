-- Run this script in the Supabase SQL Editor.
-- User passwords are managed by Supabase Auth and are never stored in these tables.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    first_name text not null default '',
    second_name text not null default '',
    last_name text not null default '',
    phone_number text not null default '',
    id_no text unique,
    created_at timestamptz not null default now(),
    constraint profiles_first_name_length check (char_length(first_name) <= 100),
    constraint profiles_second_name_length check (char_length(second_name) <= 100),
    constraint profiles_last_name_length check (char_length(last_name) <= 100),
    constraint profiles_phone_number_length check (char_length(phone_number) <= 32),
    constraint profiles_id_no_length check (id_no is null or char_length(id_no) <= 50),
    constraint profiles_id_no_digits check (id_no is null or id_no ~ '^[0-9]+$')
);

alter table public.profiles
    drop constraint if exists profiles_id_no_digits;

alter table public.profiles
    add constraint profiles_id_no_digits
    check (id_no is null or id_no ~ '^[0-9]+$');

create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users (id) on delete set null default auth.uid(),
    title text not null,
    category text not null,
    location text not null,
    description text not null,
    status text not null default 'Awaiting first response',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint reports_title_length check (char_length(title) between 1 and 200),
    constraint reports_category_check check (
        category in (
            'Roads & Traffic',
            'Water & Sewage',
            'Garbage & Sanitation',
            'Electricity & Power',
            'Public Safety'
        )
    ),
    constraint reports_location_length check (char_length(location) between 1 and 255),
    constraint reports_description_length check (char_length(description) between 1 and 10000),
    constraint reports_status_check check (
        status in ('Awaiting first response', 'In Progress', 'Resolved')
    )
);

create table if not exists public.report_attachments (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.reports (id) on delete cascade,
    storage_path text not null unique,
    original_name text not null,
    mime_type text not null,
    file_size bigint not null,
    created_at timestamptz not null default now(),
    constraint report_attachments_name_length check (char_length(original_name) between 1 and 255),
    constraint report_attachments_file_size check (file_size between 1 and 26214400),
    constraint report_attachments_mime_type check (
        mime_type in (
            'image/jpeg',
            'image/png',
            'image/webp',
            'video/mp4',
            'video/webm',
            'audio/mp4',
            'audio/webm',
            'audio/ogg',
            'application/pdf'
        )
    ),
    constraint report_attachments_storage_path check (
        storage_path like report_id::text || '/%'
    )
);

create index if not exists reports_created_at_idx
    on public.reports (created_at desc);

create index if not exists reports_user_id_idx
    on public.reports (user_id);

create index if not exists report_attachments_report_id_idx
    on public.report_attachments (report_id);

create table if not exists public.admin_users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

-- After registering an administrator account, grant access with:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict (user_id) do nothing;

create table if not exists public.report_solutions (
    report_id uuid primary key references public.reports (id) on delete cascade,
    response_text text not null,
    action_taken text not null,
    status text not null default 'In Progress',
    reference_file_path text,
    reference_file_name text,
    reference_mime_type text,
    responded_by uuid references auth.users (id) on delete set null default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint report_solutions_status_check check (status in ('In Progress', 'Resolved')),
    constraint report_solutions_reference_mime_type_check check (
        reference_mime_type is null or reference_mime_type in (
            'image/jpeg',
            'image/png',
            'image/webp',
            'video/mp4',
            'video/webm',
            'audio/mp4',
            'audio/webm',
            'audio/ogg',
            'application/pdf'
        )
    )
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

drop trigger if exists report_solutions_set_updated_at on public.report_solutions;
create trigger report_solutions_set_updated_at
before update on public.report_solutions
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, first_name, second_name, last_name, phone_number, id_no)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'first_name', ''),
        coalesce(new.raw_user_meta_data ->> 'second_name', ''),
        coalesce(new.raw_user_meta_data ->> 'last_name', ''),
        coalesce(new.phone, new.raw_user_meta_data ->> 'phone_number', ''),
        nullif(new.raw_user_meta_data ->> 'id_no', '')
    )
    on conflict (id) do update set
        first_name = coalesce(nullif(excluded.first_name, ''), profiles.first_name),
        second_name = coalesce(nullif(excluded.second_name, ''), profiles.second_name),
        last_name = coalesce(nullif(excluded.last_name, ''), profiles.last_name),
        phone_number = coalesce(nullif(excluded.phone_number, ''), profiles.phone_number),
        id_no = coalesce(excluded.id_no, profiles.id_no);

    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        - array['first_name', 'second_name', 'last_name', 'phone_number', 'id_no']
    where id = new.id;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;

insert into public.profiles (id, first_name, second_name, last_name, phone_number, id_no)
select
    id,
    coalesce(raw_user_meta_data ->> 'first_name', ''),
    coalesce(raw_user_meta_data ->> 'second_name', ''),
    coalesce(raw_user_meta_data ->> 'last_name', ''),
    coalesce(phone, raw_user_meta_data ->> 'phone_number', ''),
    nullif(raw_user_meta_data ->> 'id_no', '')
from auth.users
on conflict (id) do update set
    first_name = coalesce(nullif(excluded.first_name, ''), profiles.first_name),
    second_name = coalesce(nullif(excluded.second_name, ''), profiles.second_name),
    last_name = coalesce(nullif(excluded.last_name, ''), profiles.last_name),
    phone_number = coalesce(nullif(excluded.phone_number, ''), profiles.phone_number),
    id_no = coalesce(excluded.id_no, profiles.id_no);

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    - array['first_name', 'second_name', 'last_name', 'phone_number', 'id_no']
where raw_user_meta_data ?| array['first_name', 'second_name', 'last_name', 'phone_number', 'id_no'];

create or replace function public.enforce_report_attachment_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    current_count integer;
    current_total bigint;
begin
    perform 1
    from public.reports
    where id = new.report_id
    for update;

    if not found then
        raise exception 'Report does not exist';
    end if;

    select count(*), coalesce(sum(file_size), 0)
    into current_count, current_total
    from public.report_attachments
    where report_id = new.report_id
      and (tg_op = 'INSERT' or id <> new.id);

    if tg_op = 'INSERT' and current_count >= 5 then
        raise exception 'A report can have no more than 5 attachments';
    end if;
    if current_total + new.file_size > 52428800 then
        raise exception 'Report attachments cannot exceed 50 MB in total';
    end if;

    return new;
end;
$$;

drop trigger if exists report_attachments_enforce_limits on public.report_attachments;
create trigger report_attachments_enforce_limits
before insert or update of file_size, report_id on public.report_attachments
for each row execute function public.enforce_report_attachment_limits();

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.report_attachments enable row level security;
alter table public.admin_users enable row level security;
alter table public.report_solutions enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Admins can read resident profiles" on public.profiles;
create policy "Admins can read resident profiles"
on public.profiles for select
to authenticated
using (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

drop policy if exists "Anyone can read reports" on public.reports;
drop policy if exists "Signed-in users can read reports" on public.reports;
create policy "Signed-in users can read reports"
on public.reports for select
to authenticated
using (true);

drop policy if exists "Anyone can submit reports" on public.reports;
drop policy if exists "Signed-in users can submit their own reports" on public.reports;
create policy "Signed-in users can submit their own reports"
on public.reports for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Admins can update reports" on public.reports;
create policy "Admins can update reports"
on public.reports for update
to authenticated
using (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
)
with check (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

drop policy if exists "Users can delete their own reports" on public.reports;
create policy "Users can delete their own reports"
on public.reports for delete
to authenticated
using (
    user_id = (select auth.uid())
    or exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

drop policy if exists "Anyone can read report attachments" on public.report_attachments;
drop policy if exists "Signed-in users can read report attachments" on public.report_attachments;
create policy "Signed-in users can read report attachments"
on public.report_attachments for select
to authenticated
using (true);

drop policy if exists "Anyone can attach files to reports" on public.report_attachments;
drop policy if exists "Report owners and admins can attach files" on public.report_attachments;
create policy "Report owners and admins can attach files"
on public.report_attachments for insert
to authenticated
with check (
    exists (
        select 1
        from public.reports
        where id = report_id
          and (
              user_id = (select auth.uid())
              or exists (select 1 from public.admin_users where user_id = (select auth.uid()))
          )
    )
);

drop policy if exists "Admins can update saved report attachments" on public.report_attachments;
create policy "Admins can update saved report attachments"
on public.report_attachments for update
to authenticated
using (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
)
with check (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

drop policy if exists "Admins can delete saved report attachments" on public.report_attachments;
create policy "Admins can delete saved report attachments"
on public.report_attachments for delete
to authenticated
using (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

drop policy if exists "Users can read their own admin status" on public.admin_users;
create policy "Users can read their own admin status"
on public.admin_users for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read report solutions" on public.report_solutions;
drop policy if exists "Signed-in users can read report solutions" on public.report_solutions;
create policy "Signed-in users can read report solutions"
on public.report_solutions for select
to authenticated
using (true);

drop policy if exists "Admins can create report solutions" on public.report_solutions;
create policy "Admins can create report solutions"
on public.report_solutions for insert
to authenticated
with check (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
    and responded_by = (select auth.uid())
);

drop policy if exists "Admins can update report solutions" on public.report_solutions;
create policy "Admins can update report solutions"
on public.report_solutions for update
to authenticated
using (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
)
with check (
    exists (select 1 from public.admin_users where user_id = (select auth.uid()))
);

grant usage on schema public to anon, authenticated;
revoke all on public.reports, public.report_attachments, public.admin_users, public.report_solutions
    from public, anon, authenticated;
grant select, insert, update, delete on public.reports to authenticated;
grant select, insert, update, delete on public.report_attachments to authenticated;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, second_name, last_name, phone_number)
    on public.profiles to authenticated;
grant select on public.admin_users to authenticated;
grant select on public.report_solutions to authenticated;
grant insert, update on public.report_solutions to authenticated;

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'report-attachments',
    'report-attachments',
    false,
    26214400,
    array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/webm',
        'audio/mp4',
        'audio/webm',
        'audio/ogg',
        'application/pdf'
    ]
)
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view report attachment files" on storage.objects;
drop policy if exists "Signed-in users can view report attachment files" on storage.objects;
create policy "Signed-in users can view report attachment files"
on storage.objects for select
to authenticated
using (bucket_id = 'report-attachments');

drop policy if exists "Anyone can upload report attachment files" on storage.objects;
drop policy if exists "Report owners and admins can upload attachment files" on storage.objects;
create policy "Report owners and admins can upload attachment files"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'report-attachments'
    and (
        (
            (storage.foldername(name))[1] = 'solutions'
            and exists (select 1 from public.admin_users where user_id = (select auth.uid()))
        )
        or exists (
            select 1
            from public.reports
            where id::text = (storage.foldername(name))[1]
              and (
                  user_id = (select auth.uid())
                  or exists (select 1 from public.admin_users where user_id = (select auth.uid()))
              )
        )
    )
);

drop policy if exists "Report owners and admins can delete attachment files" on storage.objects;
create policy "Report owners and admins can delete attachment files"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'report-attachments'
    and (
        (
            (storage.foldername(name))[1] = 'solutions'
            and exists (select 1 from public.admin_users where user_id = (select auth.uid()))
        )
        or exists (
            select 1
            from public.reports
            where id::text = (storage.foldername(name))[1]
              and (
                  user_id = (select auth.uid())
                  or exists (select 1 from public.admin_users where user_id = (select auth.uid()))
              )
        )
    )
);
