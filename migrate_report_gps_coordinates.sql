-- Run this script in the Supabase SQL Editor or with `supabase db query --linked`.

alter table public.reports
    add column if not exists latitude double precision,
    add column if not exists longitude double precision;

alter table public.reports
    drop constraint if exists reports_coordinates_pair,
    drop constraint if exists reports_latitude_range,
    drop constraint if exists reports_longitude_range;

alter table public.reports
    add constraint reports_coordinates_pair
        check ((latitude is null) = (longitude is null)),
    add constraint reports_latitude_range
        check (latitude is null or latitude between -90 and 90),
    add constraint reports_longitude_range
        check (longitude is null or longitude between -180 and 180);

alter table public.reports
    drop constraint if exists reports_coordinates_required;

alter table public.reports
    add constraint reports_coordinates_required
        check (latitude is not null and longitude is not null) not valid;