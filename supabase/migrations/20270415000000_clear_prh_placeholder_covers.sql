-- One-time cleanup: titles showing PRH's "Cover Coming Soon" picture show the usual "no cover" instead.
--
-- The catalog cleared these placeholders (tools/prh-auto-import.mjs --refresh-covers), but catalog_apply keeps a
-- shop's cover when the catalog has none, so the shops still had the copies they synced earlier. The importer no
-- longer saves the placeholder anywhere, so this only has to run once. The pictures are matched by the hash in their
-- file name (PLACEHOLDER_COVERS in js/import/apply.js); a title gets its real cover from the catalog once PRH has it.

update public.items
   set cover_url = null, cover_thumb_url = null
 where cover_url ~ '/covers/prh/[^/]*-(88f89a9e1a|48fb1ed2e3)\.\w+$'
    or cover_thumb_url ~ '/covers/prh/[^/]*-(88f89a9e1a|48fb1ed2e3)-sm\.\w+$';
