-- Display-name blocklist, stored in ALREADY-NORMALIZED form: lowercase,
-- unaccented, leet-folded, non-alphanumerics stripped, runs of 3+ identical
-- characters collapsed. normalize_name() puts the candidate through the same
-- pipeline before matching, so an un-normalized entry here would simply never
-- match anything.
--
-- Matching is word-boundary, not substring, which is what keeps "Cassandra"
-- from tripping over 'ass'. Because normalization also strips separators, a
-- normalized name is a single word — so in practice an entry blocks names that
-- normalize to exactly it. That under-blocks run-together compounds; the table
-- is editable at runtime with no redeploy, which is the intended remedy.
--
-- 'cono' covers 'coño' because unaccent folds ñ to n. This knowingly also
-- blocks the innocent Spanish "cono" (cone) — an accepted tradeoff per the
-- spec, undone with one `delete from banned_words where word = 'cono'`.

insert into banned_words (word) values
  -- English (51)
  ('fuck'), ('fucker'), ('fucking'), ('shit'), ('shitter'), ('bullshit'),
  ('cunt'), ('bitch'), ('asshole'), ('bastard'), ('dick'), ('dickhead'),
  ('cock'), ('pussy'), ('whore'), ('slut'), ('damn'), ('piss'), ('prick'),
  ('twat'), ('wanker'), ('bollocks'), ('arse'), ('ass'), ('jizz'), ('cum'),
  ('dildo'), ('boner'), ('blowjob'), ('handjob'), ('tits'), ('titties'),
  ('boobs'), ('anal'), ('sodomy'), ('nigger'), ('nigga'), ('faggot'), ('fag'),
  ('dyke'), ('spic'), ('chink'), ('kike'), ('wetback'), ('tranny'), ('retard'),
  ('rape'), ('rapist'), ('pedo'), ('pedophile'), ('molester'),
  -- Spanish (51)
  ('mierda'), ('cono'), ('joder'), ('jodete'), ('puta'), ('puto'), ('putita'),
  ('cabron'), ('cabrona'), ('gilipollas'), ('pendejo'), ('pendeja'), ('verga'),
  ('chinga'), ('chingar'), ('chingada'), ('chingon'), ('culero'), ('pinche'),
  ('marica'), ('maricon'), ('polla'), ('cojones'), ('hostia'), ('capullo'),
  ('zorra'), ('zorrita'), ('follar'), ('teta'), ('tetas'), ('culo'), ('caca'),
  ('cagar'), ('cagada'), ('mamon'), ('mamada'), ('chupame'), ('huevon'),
  ('boludo'), ('pelotudo'), ('concha'), ('carajo'), ('chucha'), ('cachondo'),
  ('joto'), ('panocha'), ('malparido'), ('gonorrea'), ('hijueputa'),
  ('mierdero'), ('putero')
on conflict do nothing;
