-- rehearsal/origin-plant.sql — one run V141 (DJ.1, #1313) must refuse to classify.
--
-- Applied to a copy of a seeded database migrated to V140 only. The planted run is a copy of
-- a seeded one with an id outside the seed's `5eed` convention, no simulator watermark and no
-- AP.1 `run.create` receipt — so nothing says whether it is live, simulated or seeded, and
-- V141 has to stop with a count rather than guess.
insert into ouroboros.runs
select (jsonb_populate_record(
          null::ouroboros.runs,
          to_jsonb(run) || jsonb_build_object(
            'id', 'aaaa0000-0000-4000-8000-000000001313',
            'loop_seq', 913130,
            'simulated', false)
        )).*
  from ouroboros.runs run
 where run.id = '5eed0009-0000-4000-8000-000000000482';
