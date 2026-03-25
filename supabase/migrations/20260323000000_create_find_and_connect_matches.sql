CREATE OR REPLACE FUNCTION find_and_connect_matches(input_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  me RECORD;
  match RECORD;
  conv_id uuid;
  results jsonb := '[]'::jsonb;
  match_count int := 0;
BEGIN
  -- Load the input user's surfer row
  SELECT * INTO me
  FROM surfers
  WHERE user_id = input_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Surfer not found for user_id %', input_user_id;
  END IF;

  -- Score all eligible surfers and iterate top 3
  FOR match IN
    WITH scored AS (
      SELECT
        s.user_id,

        -- TIER 1: age proximity (60 pts max)
        CASE
          WHEN me.age IS NULL OR s.age IS NULL THEN 0
          WHEN ABS(me.age - s.age) <= 2 THEN 60
          WHEN ABS(me.age - s.age) <= 4 THEN 40
          WHEN ABS(me.age - s.age) <= 7 THEN 30
          WHEN ABS(me.age - s.age) <= 10 THEN 20
          WHEN ABS(me.age - s.age) <= 15 THEN 10
          ELSE 0
        END AS age_score,

        -- TIER 1: country_from exact match (40 pts max)
        CASE
          WHEN me.country_from IS NULL OR s.country_from IS NULL THEN 0
          WHEN me.country_from = s.country_from THEN 40
          ELSE 0
        END AS country_score,

        -- TIER 1: surf_level_category exact or adjacent (40 pts max)
        CASE
          WHEN me.surf_level_category IS NULL OR s.surf_level_category IS NULL THEN 0
          WHEN me.surf_level_category = s.surf_level_category THEN 40
          WHEN (me.surf_level_category = 'beginner'     AND s.surf_level_category = 'intermediate')
            OR (me.surf_level_category = 'intermediate'  AND s.surf_level_category = 'beginner')
            OR (me.surf_level_category = 'intermediate'  AND s.surf_level_category = 'advanced')
            OR (me.surf_level_category = 'advanced'      AND s.surf_level_category = 'intermediate')
            OR (me.surf_level_category = 'advanced'      AND s.surf_level_category = 'pro')
            OR (me.surf_level_category = 'pro'           AND s.surf_level_category = 'advanced')
          THEN 20
          ELSE 0
        END AS surf_level_score,

        -- TIER 1: surfboard_type exact match (40 pts max)
        CASE
          WHEN me.surfboard_type IS NULL OR s.surfboard_type IS NULL THEN 0
          WHEN me.surfboard_type = s.surfboard_type THEN 40
          ELSE 0
        END AS board_score,

        -- TIER 2: lifestyle_keywords Jaccard overlap (60 pts max)
        CASE
          WHEN me.lifestyle_keywords IS NULL OR s.lifestyle_keywords IS NULL
               OR array_length(me.lifestyle_keywords, 1) IS NULL
               OR array_length(s.lifestyle_keywords, 1) IS NULL THEN 0
          ELSE ROUND(
            60.0 * (
              SELECT COUNT(*)
              FROM unnest(me.lifestyle_keywords) mk
              WHERE mk = ANY(s.lifestyle_keywords)
            )::numeric / GREATEST(
              (SELECT COUNT(DISTINCT val) FROM (
                SELECT unnest(me.lifestyle_keywords) AS val
                UNION
                SELECT unnest(s.lifestyle_keywords) AS val
              ) combined),
              1
            )
          )
        END AS lifestyle_score

      FROM surfers s
      WHERE s.finished_onboarding = true
        AND s.is_demo_user = false
        AND s.user_id != input_user_id
    )
    SELECT *,
      (age_score + country_score + surf_level_score + board_score
       + lifestyle_score) AS total_score
    FROM scored
    ORDER BY total_score DESC
    LIMIT 3
  LOOP
    match_count := match_count + 1;

    -- Check if a direct conversation already exists between these two users
    conv_id := NULL;
    SELECT cm1.conversation_id INTO conv_id
    FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    JOIN conversations c ON c.id = cm1.conversation_id
    WHERE cm1.user_id = input_user_id
      AND cm2.user_id = match.user_id
      AND c.is_direct = true
    LIMIT 1;

    -- Only create if no existing conversation
    IF conv_id IS NULL THEN
      INSERT INTO conversations (is_direct, created_by)
      VALUES (true, input_user_id)
      RETURNING id INTO conv_id;

      INSERT INTO conversation_members (conversation_id, user_id, role, adv_role)
      VALUES
        (conv_id, input_user_id, 'owner', null),
        (conv_id, match.user_id, 'member', null);
    END IF;

    results := results || jsonb_build_object(
      'user_id', match.user_id,
      'conversation_id', conv_id,
      'total_score', match.total_score,
      'scores', jsonb_build_object(
        'age', match.age_score,
        'country', match.country_score,
        'surf_level', match.surf_level_score,
        'board', match.board_score,
        'lifestyle', match.lifestyle_score
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'matches', results,
    'match_count', match_count
  );
END;
$$;
