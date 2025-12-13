-- Simple SQL script to create 200 demo surfers
-- Run this in Supabase SQL Editor

-- Function to create demo surfers
CREATE OR REPLACE FUNCTION create_demo_surfers()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  i INTEGER;
  user_id_val UUID;
  name_val VARCHAR(255);
  age_val INTEGER;
  pronoun_val VARCHAR(50);
  country_from_val VARCHAR(255);
  surfboard_type_val surfboard_type;
  surf_level_val INTEGER;
  travel_experience_val travel_experience;
  bio_val TEXT;
  travel_type_val TEXT;
  travel_buddies_val TEXT;
  lifestyle_keywords_val TEXT[];
  wave_type_keywords_val TEXT[];
  destinations_array_val JSONB;
  
  countries TEXT[] := ARRAY[
    'USA', 'Israel', 'Costa Rica', 'Nicaragua', 'Panama', 'El Salvador', 
    'Brazil', 'Australia', 'France', 'Portugal', 'Spain'
  ];
  
  usa_locations TEXT[] := ARRAY[
    'California', 'Hawaii', 'Florida', 'New York', 'Oregon', 'Washington'
  ];
  
  popular_destinations TEXT[] := ARRAY[
    'Sri Lanka, South', 'Sri Lanka, Arugam Bay', 'Sri Lanka, Weligama',
    'Indonesia, Bali', 'Indonesia, Mentawai', 'Indonesia, Lombok',
    'Costa Rica, Tamarindo', 'Costa Rica, Nosara', 'Costa Rica, Santa Teresa',
    'Nicaragua, Popoyo', 'Nicaragua, San Juan del Sur',
    'Panama, Bocas del Toro', 'Panama, Santa Catalina',
    'El Salvador, El Tunco', 'El Salvador, La Libertad',
    'Brazil, Florianopolis', 'Brazil, Itacaré', 'Brazil, Fernando de Noronha',
    'Australia, Gold Coast', 'Australia, Byron Bay', 'Australia, Margaret River',
    'Portugal, Ericeira', 'Portugal, Nazaré', 'Portugal, Peniche',
    'France, Biarritz', 'France, Hossegor', 'France, Lacanau',
    'Spain, San Sebastian', 'Spain, Mundaka', 'Spain, Tarifa',
    'Morocco, Taghazout', 'Morocco, Imsouane',
    'Mexico, Puerto Escondido', 'Mexico, Sayulita', 'Mexico, Todos Santos',
    'Peru, Chicama', 'Peru, Máncora',
    'Fiji, Cloudbreak', 'Fiji, Tavarua',
    'Maldives, North Male', 'Maldives, Central Atolls',
    'Philippines, Siargao', 'Philippines, La Union',
    'South Africa, Jeffrey''s Bay', 'South Africa, Muizenberg',
    'Chile, Pichilemu', 'Chile, Arica'
  ];
  
  board_types surfboard_type[] := ARRAY['shortboard', 'mid_length', 'longboard', 'soft_top'];
  travel_exps travel_experience[] := ARRAY['new_nomad', 'rising_voyager', 'wave_hunter', 'chicken_joe'];
  travel_types TEXT[] := ARRAY['budget', 'mid', 'high'];
  travel_buddies_arr TEXT[] := ARRAY['solo', '2', 'crew'];
  
  lifestyle_pool TEXT[] := ARRAY[
    'remote-work', 'party', 'nightlife', 'culture', 'local culture', 'nature',
    'sustainability', 'volleyball', 'climbing', 'yoga', 'diving', 'fishing',
    'art', 'music', 'food', 'exploring', 'adventure', 'mobility', 'photography',
    'surfing', 'beach', 'community', 'backpacking', 'wellness'
  ];
  
  wave_pool TEXT[] := ARRAY[
    'barrels', 'big waves', 'fast waves', 'small waves', 'mellow', 'reef',
    'sand', 'beach break', 'point break', 'reef break', 'low crowd', 'crowded',
    'powerful', 'hollow', 'peeling', 'long rides', 'shortboard waves', 'longboard waves'
  ];
  
  first_names TEXT[] := ARRAY[
    'Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Avery', 'Quinn',
    'Sam', 'Jamie', 'Dakota', 'Sage', 'River', 'Phoenix', 'Skyler', 'Rowan',
    'Noah', 'Emma', 'Liam', 'Olivia', 'Mason', 'Sophia', 'Ethan', 'Isabella',
    'Lucas', 'Mia', 'Aiden', 'Charlotte', 'Caden', 'Amelia', 'Logan', 'Harper',
    'Owen', 'Evelyn', 'Carter', 'Abigail', 'Wyatt', 'Emily', 'Luke', 'Elizabeth',
    'Henry', 'Sofia', 'Jack', 'Avery', 'Levi', 'Ella', 'Sebastian', 'Scarlett',
    'Mateo', 'Victoria', 'Theo', 'Grace', 'Hudson', 'Chloe', 'Maya', 'Layla',
    'Zoe', 'Nora', 'Lily', 'Hannah', 'Addison', 'Eleanor'
  ];
  
  last_names TEXT[] := ARRAY[
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor',
    'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris', 'Sanchez',
    'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
    'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
    'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
  ];
  
  pronouns_arr TEXT[] := ARRAY['he/him', 'she/her', 'they/them'];
  
  num_destinations INTEGER;
  dest_index INTEGER;
  destination_name TEXT;
  time_in_days INTEGER;
  country_idx INTEGER;
  country_name TEXT;
  dest_obj JSONB;
  
BEGIN
  FOR i IN 1..200 LOOP
    user_id_val := gen_random_uuid();
    name_val := first_names[1 + floor(random() * array_length(first_names, 1))] || ' ' || 
                last_names[1 + floor(random() * array_length(last_names, 1))];
    age_val := 18 + floor(random() * 38)::INTEGER;
    pronoun_val := pronouns_arr[1 + floor(random() * array_length(pronouns_arr, 1))];
    
    country_idx := 1 + floor(random() * array_length(countries, 1));
    country_name := countries[country_idx];
    
    IF country_name = 'USA' THEN
      country_from_val := usa_locations[1 + floor(random() * array_length(usa_locations, 1))] || ', USA';
    ELSE
      country_from_val := country_name;
    END IF;
    
    surfboard_type_val := board_types[1 + floor(random() * array_length(board_types, 1))];
    surf_level_val := LEAST(5, GREATEST(1, floor(2 + random() * 3 + (random() - 0.5) * 2)::INTEGER));
    travel_experience_val := travel_exps[1 + floor(random() * array_length(travel_exps, 1))];
    
    bio_val := 'Passionate surfer from ' || country_from_val || ' with ' || 
               CASE surf_level_val
                 WHEN 1 THEN 'beginner'
                 WHEN 2 THEN 'beginner-intermediate'
                 WHEN 3 THEN 'intermediate'
                 WHEN 4 THEN 'intermediate-advanced'
                 ELSE 'advanced'
               END || ' skills.';
    
    travel_type_val := travel_types[1 + floor(random() * array_length(travel_types, 1))];
    travel_buddies_val := travel_buddies_arr[1 + floor(random() * array_length(travel_buddies_arr, 1))];
    
    lifestyle_keywords_val := ARRAY(
      SELECT DISTINCT lifestyle_pool[1 + floor(random() * array_length(lifestyle_pool, 1))]
      FROM generate_series(1, 2 + floor(random() * 5)::INTEGER)
      LIMIT 2 + floor(random() * 5)::INTEGER
    );
    
    wave_type_keywords_val := ARRAY(
      SELECT DISTINCT wave_pool[1 + floor(random() * array_length(wave_pool, 1))]
      FROM generate_series(1, 2 + floor(random() * 4)::INTEGER)
      LIMIT 2 + floor(random() * 4)::INTEGER
    );
    
    num_destinations := 1 + floor(random() * 4)::INTEGER;
    destinations_array_val := '[]'::JSONB;
    
    FOR dest_index IN 1..num_destinations LOOP
      IF dest_index = 1 AND i <= array_length(popular_destinations, 1) THEN
        destination_name := popular_destinations[((i - 1) % array_length(popular_destinations, 1)) + 1];
      ELSE
        destination_name := popular_destinations[1 + floor(random() * array_length(popular_destinations, 1))];
      END IF;
      
      time_in_days := 7 + floor(random() * 173)::INTEGER;
      IF random() > 0.3 THEN
        time_in_days := 7 + floor(random() * 83)::INTEGER;
      END IF;
      
      dest_obj := jsonb_build_object(
        'destination_name', destination_name,
        'time_in_days', time_in_days
      );
      
      destinations_array_val := destinations_array_val || dest_obj;
    END LOOP;
    
    onboarding_summary_text_val := 
      name_val || ' is a ' || 
      CASE travel_type_val
        WHEN 'budget' THEN 'budget'
        WHEN 'mid' THEN 'mid-range'
        ELSE 'high-end'
      END || 
      ' traveler from ' || country_from_val || 
      ' who typically travels ' || 
      CASE travel_buddies_val
        WHEN 'solo' THEN 'solo'
        WHEN '2' THEN 'with a friend or partner'
        ELSE 'with a crew'
      END || '.';
    
    INSERT INTO public.users (id, email, role, created_at, updated_at)
    VALUES (
      user_id_val,
      LOWER(REPLACE(name_val, ' ', '.')) || i || '@demo.swellyo.com',
      'traveler',
      NOW() - (random() * INTERVAL '365 days'),
      NOW() - (random() * INTERVAL '365 days')
    )
    ON CONFLICT (id) DO NOTHING;
    
    INSERT INTO public.surfers (
      user_id, name, age, pronoun, country_from, surfboard_type, surf_level,
      travel_experience, bio, profile_image_url, onboarding_summary_text,
      destinations_array, travel_type, travel_buddies, lifestyle_keywords,
      wave_type_keywords, is_demo_user, created_at, updated_at
    )
    VALUES (
      user_id_val,
      name_val,
      age_val,
      pronoun_val,
      country_from_val,
      surfboard_type_val,
      surf_level_val,
      travel_experience_val,
      bio_val,
      'https://api.dicebear.com/7.x/avataaars/svg?seed=' || name_val,
      onboarding_summary_text_val,
      destinations_array_val,
      travel_type_val,
      travel_buddies_val,
      lifestyle_keywords_val,
      wave_type_keywords_val,
      true, -- Mark as demo user
      NOW() - (random() * INTERVAL '365 days'),
      NOW() - (random() * INTERVAL '365 days')
    )
    ON CONFLICT (user_id) DO NOTHING;
    
    IF i % 50 = 0 THEN
      RAISE NOTICE 'Created % surfers...', i;
    END IF;
    
  END LOOP;
  
  RAISE NOTICE 'Successfully created 200 demo surfers!';
END;
$$;

-- Run the function
SELECT create_demo_surfers();

