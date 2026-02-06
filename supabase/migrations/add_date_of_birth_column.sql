-- Add date_of_birth column to surfers table with validation constraints
-- Age will be automatically calculated via trigger

-- Add date_of_birth column with validation
ALTER TABLE public.surfers 
ADD COLUMN IF NOT EXISTS date_of_birth DATE
CHECK (
  date_of_birth IS NULL OR (
    date_of_birth <= CURRENT_DATE AND
    date_of_birth >= CURRENT_DATE - INTERVAL '120 years' AND
    EXTRACT(YEAR FROM AGE(date_of_birth)) >= 13
  )
);

-- Create database function to calculate age from DOB
CREATE OR REPLACE FUNCTION calculate_age_from_dob(dob DATE)
RETURNS INTEGER AS $$
BEGIN
  IF dob IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(YEAR FROM AGE(dob));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create trigger function to auto-update age from DOB
CREATE OR REPLACE FUNCTION update_age_from_dob()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age = calculate_age_from_dob(NEW.date_of_birth);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_update_age_from_dob ON public.surfers;

-- Create trigger to auto-update age from DOB
CREATE TRIGGER trigger_update_age_from_dob
BEFORE INSERT OR UPDATE OF date_of_birth ON public.surfers
FOR EACH ROW
EXECUTE FUNCTION update_age_from_dob();

-- Add comment for documentation
COMMENT ON COLUMN public.surfers.date_of_birth IS 
'User date of birth. Age is automatically calculated via trigger.';

