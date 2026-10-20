-- 0002_sql_functions_sequence — polygon validator and booking reference sequence (DATABASE.md §6.6)
-- Source: DATABASE.md §10.1 (migration set), §6 (hand-written SQL).
-- Applied by `prisma migrate deploy`; never edited after it has run anywhere.

CREATE FUNCTION spm_polygon_ok(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  n integer;
  i integer;
  x1 numeric; y1 numeric; x2 numeric; y2 numeric;
  twice_area numeric := 0;
BEGIN
  IF jsonb_typeof(p) <> 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(p);
  IF n < 3 THEN
    RETURN false;
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    IF jsonb_typeof(p -> i) <> 'array' OR jsonb_array_length(p -> i) <> 2 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof((p -> i) -> 0) <> 'number' OR jsonb_typeof((p -> i) -> 1) <> 'number' THEN
      RETURN false;
    END IF;
    x1 := ((p -> i) ->> 0)::numeric;
    y1 := ((p -> i) ->> 1)::numeric;
    IF x1 < 0 OR x1 > 1 OR y1 < 0 OR y1 > 1 THEN
      RETURN false;
    END IF;
    x2 := ((p -> ((i + 1) % n)) ->> 0)::numeric;
    y2 := ((p -> ((i + 1) % n)) ->> 1)::numeric;
    twice_area := twice_area + (x1 * y2 - x2 * y1);
  END LOOP;
  RETURN abs(twice_area) > 1e-9;
END $$;

CREATE SEQUENCE booking_ref_seq AS bigint START WITH 1001 INCREMENT BY 1 NO CYCLE;

ALTER TABLE booking
  ALTER COLUMN booking_ref
  SET DEFAULT ('BK-' || nextval('booking_ref_seq'));
