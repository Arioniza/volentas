-- ============================================================
--  VOLENTAS — Kunden, Abos, Ausgaben und Archiv
--  Einmal komplett im Supabase SQL-Editor ausführen.
--  Kann gefahrlos mehrmals ausgeführt werden.
-- ============================================================

-- Kunden / Objekte (vorher nur auf dem jeweiligen Gerät gespeichert)
create table if not exists public.kunden (
  id         text primary key,
  firma      text not null,
  objekt     text,
  kontakt    text,
  strasse    text,
  plzort     text,
  email      text,
  tel        text,
  created_at timestamptz not null default now()
);

-- Abos: daraus erstellt die App fällige Rechnungen als Entwurf
create table if not exists public.abos (
  id               text primary key,
  kunde            text not null,
  kontakt          text,
  strasse          text,
  plzort           text,
  objekt           text not null,
  email            text,
  leistung         text not null,
  betrag           numeric(12,2) not null check (betrag > 0),
  intervall_monate integer not null default 1 check (intervall_monate between 1 and 24),
  naechste         date not null,
  aktiv            boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Ausgaben (Kosten), für den Überblick Einnahmen / Ausgaben
create table if not exists public.ausgaben (
  id           text primary key,
  datum        date not null,
  beschreibung text not null,
  kategorie    text,
  betrag       numeric(12,2) not null check (betrag > 0),
  bemerkung    text,
  created_at   timestamptz not null default now()
);

-- Archiv: alte Rechnungen ausblenden, ohne sie zu löschen
alter table public.rechnungen add column if not exists archiviert boolean not null default false;

-- Nur eingeloggte Nutzer dürfen lesen und schreiben (wie bei Rechnungen/Offerten)
alter table public.kunden   enable row level security;
alter table public.abos     enable row level security;
alter table public.ausgaben enable row level security;

drop policy if exists "vol_auth_all" on public.kunden;
drop policy if exists "vol_auth_all" on public.abos;
drop policy if exists "vol_auth_all" on public.ausgaben;

create policy "vol_auth_all" on public.kunden
  for all to authenticated using (true) with check (true);
create policy "vol_auth_all" on public.abos
  for all to authenticated using (true) with check (true);
create policy "vol_auth_all" on public.ausgaben
  for all to authenticated using (true) with check (true);
