-- Run this migration in the Supabase SQL Editor to save verified email replies to the report wall.

alter table public.report_messages
    add column if not exists inbound_email_id text;

create unique index if not exists report_messages_inbound_email_id_uidx
    on public.report_messages (inbound_email_id);

create or replace function public.save_email_report_reply(
    p_report_id uuid,
    p_email_id text,
    p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_email_id is null or char_length(p_email_id) not between 1 and 255 then
        raise exception 'Invalid received email ID';
    end if;
    if p_message is null or char_length(btrim(p_message)) not between 1 and 5000 then
        raise exception 'Reply must contain between 1 and 5000 characters';
    end if;

    insert into public.report_messages (report_id, message, inbound_email_id)
    values (p_report_id, btrim(p_message), p_email_id)
    on conflict (inbound_email_id) do nothing;
end;
$$;

revoke all on function public.save_email_report_reply(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_email_report_reply(uuid, text, text) to service_role;
