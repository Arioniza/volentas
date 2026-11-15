-- ============================================================
--  VOLENTAS — Tabellen für Kunden und Abos
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

-- Nur eingeloggte Nutzer dürfen lesen und schreiben (wie bei Rechnungen/Offerten)
alter table public.kunden enable row level security;
alter table public.abos   enable row level security;

drop policy if exists "vol_auth_all" on public.kunden;
drop policy if exists "vol_auth_all" on public.abos;

create policy "vol_auth_all" on public.kunden
  for all to authenticated using (true) with check (true);
create policy "vol_auth_all" on public.abos
  for all to authenticated using (true) with check (true);
