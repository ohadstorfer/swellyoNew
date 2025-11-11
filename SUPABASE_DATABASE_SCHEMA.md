# Supabase Database Schema

This document describes the expected database schema for the Swellyo app.

## Tables

### 1. `users` Table

This table stores basic user information.

**Actual Schema:**
```sql
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  email varchar(255) NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'traveler',
  user_type varchar(255),  -- New column
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Columns:**
- `id` (uuid, primary key) - Auto-generated UUID
- `email` (varchar(255), unique, not null) - User's email address
- `role` (user_role enum, default 'traveler') - User role
- `user_type` (varchar(255), nullable) - User type (new column)
- `created_at` (timestamptz) - When the record was created
- `updated_at` (timestamptz) - When the record was last updated

**Note:** The `users` table only stores basic authentication info. All profile data goes to the `surfers` table.

### 2. `surfers` Table

This table stores surfer-specific experience and preferences.

**Actual Schema:**
```sql
CREATE TABLE public.surfers (
  user_id uuid PRIMARY KEY,
  name varchar(255) NOT NULL,
  age integer CHECK (age >= 0),
  pronoun varchar(50),
  country_from varchar(255),
  surfboard_type surfboard_type,  -- ENUM
  surf_level integer CHECK (surf_level >= 1 AND surf_level <= 5),
  travel_experience travel_experience,  -- ENUM
  bio text,
  profile_image_url varchar(2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns:**
- `user_id` (uuid, primary key) - Foreign key to `users.id`
- `name` (varchar(255), not null) - User's display name
- `age` (integer, nullable, check >= 0) - User's age
- `pronoun` (varchar(50), nullable) - User's pronouns
- `country_from` (varchar(255), nullable) - User's location/country
- `surfboard_type` (surfboard_type enum, nullable) - Selected board type
- `surf_level` (integer, nullable, check 1-5) - Selected surf level (1-5, not 0-4)
- `travel_experience` (travel_experience enum, nullable) - Travel experience level
- `bio` (text, nullable) - User bio
- `profile_image_url` (varchar(2048), nullable) - URL to profile picture
- `created_at` (timestamptz) - When the record was created
- `updated_at` (timestamptz) - When the record was last updated

## Setup Instructions

### 1. Create the Enums First

Before creating the tables, you need to create the enum types:

```sql
-- Create surfboard_type enum
CREATE TYPE surfboard_type AS ENUM (
  'shortboard',
  'mid_length',
  'longboard',
  'soft_top'
);

-- Create travel_experience enum
CREATE TYPE travel_experience AS ENUM (
  'new_nomad',
  'rising_voyager',
  'wave_hunter',
  'chicken_joe'
);

-- Create user_role enum (if not exists)
CREATE TYPE user_role AS ENUM (
  'traveler',
  'admin'
);
```

**Note:** Adjust the enum values to match your actual Supabase enum definitions. Check your Supabase Dashboard → Database → Types to see the actual values.

### 2. Create the Tables

The tables should already be created based on your schema. If not, use the SQL provided in the schema section above.

### 2. Set Up Row Level Security (RLS)

Enable RLS on both tables and create policies:

#### For `users` table:

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can view their own data
CREATE POLICY "Users can view own data"
ON users FOR SELECT
USING (auth.uid() = id);

-- Users can update their own data
CREATE POLICY "Users can update own data"
ON users FOR UPDATE
USING (auth.uid() = id);

-- Users can insert their own data
CREATE POLICY "Users can insert own data"
ON users FOR INSERT
WITH CHECK (auth.uid() = id);
```

#### For `surfers` table:

```sql
-- Enable RLS
ALTER TABLE surfers ENABLE ROW LEVEL SECURITY;

-- Users can view their own surfer data
CREATE POLICY "Users can view own surfer data"
ON surfers FOR SELECT
USING (auth.uid() = user_id);

-- Users can update their own surfer data
CREATE POLICY "Users can update own surfer data"
ON surfers FOR UPDATE
USING (auth.uid() = user_id);

-- Users can insert their own surfer data
CREATE POLICY "Users can insert own surfer data"
ON surfers FOR INSERT
WITH CHECK (auth.uid() = user_id);
```

### 3. Create Updated At Trigger (Optional)

To automatically update the `updated_at` timestamp:

```sql
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to users table
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply to surfers table
CREATE TRIGGER update_surfers_updated_at
BEFORE UPDATE ON surfers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

## Data Flow

1. **User Signs In**: User authenticates with Google OAuth via Supabase
2. **User Created**: Basic user info is saved to `users` table
3. **Onboarding Steps**: As user progresses through onboarding:
   - Step 1: Board type → saved to `surfers.board_type`
   - Step 2: Surf level → saved to `surfers.surf_level`
   - Step 3: Travel experience → saved to `surfers.travel_experience`
   - Step 4: Profile details → saved to `users` table (nickname, age, location, pronouns, profile_picture)
4. **Complete**: All data is saved when Step 4 is completed

## Column Name Mapping

The service maps onboarding data to the database schema as follows:

**users table:**
- `id` → Auto-generated UUID (from auth.users.id)
- `email` → `userEmail` (from onboarding)
- `role` → Default 'traveler'
- `user_type` → `userType` (if provided)

**surfers table:**
- `user_id` → UUID from authenticated user
- `name` → `nickname` (from onboarding)
- `age` → `age` (from onboarding)
- `pronoun` → `pronouns` (from onboarding)
- `country_from` → `location` (from onboarding)
- `surfboard_type` → `boardType` (converted from number to enum)
- `surf_level` → `surfLevel` (converted from 0-4 to 1-5 range)
- `travel_experience` → `travelExperience` (converted from number to enum)
- `profile_image_url` → `profilePicture` (from onboarding)

**Important Conversions:**
1. **surf_level**: App uses 0-4, database expects 1-5. The service automatically converts (0→1, 1→2, etc.)
2. **boardType**: App uses numbers (0-3), database uses enum. Mapping:
   - 0 → 'shortboard'
   - 1 → 'mid_length'
   - 2 → 'longboard'
   - 3 → 'soft_top'
3. **travelExperience**: App uses numbers (0-3), database uses enum. Mapping:
   - 0 → 'new_nomad'
   - 1 → 'rising_voyager'
   - 2 → 'wave_hunter'
   - 3 → 'chicken_joe'

## Testing

After setting up the tables:

1. Sign in with Google
2. Complete the onboarding flow
3. Check Supabase Dashboard → Table Editor to verify data was saved
4. Check the browser console for any errors

## Troubleshooting

### "relation 'users' does not exist"
- Make sure you've created the `users` table in Supabase
- Check that you're using the correct database/schema

### "permission denied for table users"
- Make sure RLS policies are set up correctly
- Verify the user is authenticated
- Check that policies allow the current user to insert/update

### "duplicate key value violates unique constraint"
- The user already exists - this is normal, the service will update instead of insert

