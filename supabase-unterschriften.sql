-- ============================================================
--  VOLENTAS — Unterschriften per Link (z.B. Verträge)
--  Einmal im Supabase SQL-Editor ausführen. Kann mehrmals laufen.
-- ============================================================

create table if not exists public.unterschriften (
  id                text primary key,
  token             text not null unique,
  zweck             text not null,
  name              text not null,
  zusammenfassung   text,
  bild              text,
  unterschrieben_am timestamptz,
  created_at        timestamptz not null default now()
);

-- Direkt darf nur, wer in der App angemeldet ist
alter table public.unterschriften enable row level security;
drop policy if exists "vol_auth_all" on public.unterschriften;
create policy "vol_auth_all" on public.unterschriften
  for all to authenticated using (true) with check (true);

-- Die Unterschrift-Seite (ohne Login) sieht nur den einen Auftrag zu ihrem Link ...
create or replace function public.get_unterschrift_auftrag(p_token text)
returns json language sql security definer set search_path = public as $$
  select json_build_object('zweck', zweck, 'name', name, 'zusammenfassung', zusammenfassung,
                           'unterschrieben', bild is not null)
  from unterschriften where token = p_token limit 1;
$$;

-- ... und kann genau einmal unterschreiben
create or replace function public.unterschreiben(p_token text, p_bild text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_bild is null or p_bild not like 'data:image/png;base64,%' or length(p_bild) > 600000 then
    return false;
  end if;
  update unterschriften set bild = p_bild, unterschrieben_am = now()
   where token = p_token and bild is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

grant execute on function public.get_unterschrift_auftrag(text) to anon, authenticated;
grant execute on function public.unterschreiben(text, text) to anon, authenticated;

-- Auftraege (mit geheimem Link-Code) NIE hier eintragen: das Projekt ist oeffentlich.
-- Sie werden separat im SQL-Editor angelegt.
