import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LIFESTYLE_IMAGES_BUCKET = 'lifestyle-thumbnails'

const LIFESTYLE_IMAGE_FILENAMES = new Set([
  'Adventure_Explore.jpg', 'Backpacking.jpg', 'Baseball_Softball.jpg', 'Basketball.jpg', 'Beach_Cleanup.jpg',
  'Breathe_Work.jpg', 'Calisthenics_Body_Weight.jpg', 'Coffee.jpg', 'Cold_Plunges_Ice_Bath.jpg', 'Concerts_Festivals.jpg',
  'Coral_Reef_Conservation.jpg', 'Craft_Beer.jpg', 'Cycling_Triathlon.jpg', 'Dance.jpg', 'Dart.jpg',
  'Dirt_Biking_Motocross.jpg', 'Dirtbiking.jpg', 'Fishing.jpg', 'Fly_Fishing.jpg', 'Football.jpg',
  'Free_Diving.jpg', 'Golf.jpg', 'Gym_Fitness_Workout_Crossfit.jpg', 'Hiking.jpg', 'Ice_Hockey.jpg',
  'Ice_Skating.jpg', 'Jetskiing.jpg', 'Kayaking.jpg', 'Kite_Surfing.jpg', 'Live_Music.jpg',
  'Local_Culture.jpg', 'Local_Food.jpg', 'Longboard(skate).jpg', 'Martial_Arts.jpg', 'Mindfullness_Meditation.jpg',
  'Mobility_Training_Stretching.jpg', 'Mountain_Biking.jpg', 'Music_Festivals.jpg', 'Nature.jpg', 'Nature_Conservation.jpg',
  'Nightlife.jpg', 'Ocean_Conservation.jpg', 'Overlanding_Van_Life.jpg', 'Paragliding.jpg', 'Photography.jpg',
  'Pickleball.jpg', 'Pilates.jpg', 'Pingpong.jpg', 'Playing_Music.jpg', 'Pool_Billiards_Snooker.jpg',
  'Reading.jpg', 'Rock_Climbing.jpg', 'Rugby.jpg', 'Running.jpg', 'SUP_Surfing.jpg', 'Safari_Wild_Animal.jpg',
  'Sailing.jpg', 'Scuba_Diving.jpg', 'Skateboarding.jpg', 'Skiing_Snowboarding.jpg', 'Skydiving.jpg',
  'Snorkeling.jpg', 'Snowmobiling.jpg', 'Soccer.jpg', 'Spear_Fishing.jpg', 'Spin_Fishing.jpg',
  'Swimming.jpg', 'Tennis.jpg', 'Travel.jpg', 'Volleyball.jpg', 'Wakeboarding_Waterskiing.jpg',
  'Whale_Watching_Dolphin_Watching.jpg', 'Wildlife_Conservation.jpg', 'Wind_Surfing.jpg', 'Wing_Foiling.jpg', 'Yoga.jpg',
])
const LIFESTYLE_IMAGE_FILENAMES_LIST = [...LIFESTYLE_IMAGE_FILENAMES].join(', ')

async function matchLifestyleKeywordsToImages(
  lifestyleKeywords: string[]
): Promise<Record<string, string | null>> {
  if (!lifestyleKeywords.length) return {}

  const prompt = `You are an image matcher. Given lifestyle keywords, match each to the BEST image filename from the list below. Return a JSON object mapping each keyword to a filename or null.

IMAGE FILES (use EXACTLY these names):
${LIFESTYLE_IMAGE_FILENAMES_LIST}

MATCHING EXAMPLES:
- Adventure_Explore.jpg: adventure, exploring, exploration, backpacking trips, thrill seeking
- Backpacking.jpg: backpacking, backpacker, travel with backpack, hostel hopping
- Baseball_Softball.jpg: baseball, softball, batting, pitching
- Basketball.jpg: basketball, hoops, shooting baskets, pickup games
- Beach_Cleanup.jpg: beach cleanup, coastal cleanup, beach volunteering, ocean cleanup
- Breathe_Work.jpg: breathwork, breathing exercises, breathe work, pranayama, wim hof breathing
- Calisthenics_Body_Weight.jpg: calisthenics, bodyweight training, pullups, pushups, street workout
- Coffee.jpg: coffee, coffee shops, barista, espresso, cafe culture
- Cold_Plunges_Ice_Bath.jpg: cold plunge, ice bath, cold water therapy, cold exposure
- Concerts_Festivals.jpg: concerts, live shows, music events, festival going
- Coral_Reef_Conservation.jpg: coral reef, reef conservation, reef restoration, marine biology
- Craft_Beer.jpg: craft beer, brewery, beer tasting, microbrewery, brewing
- Cycling_Triathlon.jpg: cycling, triathlon, road biking, bike racing, ironman
- Dance.jpg: dancing, dance, salsa, bachata, hip hop dance, ballroom
- Dart.jpg: darts, dart throwing, pub games
- Dirt_Biking_Motocross.jpg: dirt biking, motocross, enduro, off-road motorcycle
- Fishing.jpg: fishing, angling, catching fish
- Fly_Fishing.jpg: fly fishing, fly casting, river fishing, trout fishing
- Football.jpg: football, american football, NFL, throwing football
- Free_Diving.jpg: freediving, free diving, breath hold diving, apnea
- Golf.jpg: golf, golfing, driving range, putting
- Gym_Fitness_Workout_Crossfit.jpg: gym, fitness, workout, crossfit, weight training, lifting, exercise, working out, strength training
- Hiking.jpg: hiking, trekking, trail walking, hill walking, mountain walking
- Ice_Hockey.jpg: ice hockey, hockey, skating rink, puck
- Ice_Skating.jpg: ice skating, figure skating, skating rink
- Jetskiing.jpg: jet ski, jetski, jetskiing, water scooter
- Kayaking.jpg: kayaking, kayak, paddling, canoeing, sea kayak
- Kite_Surfing.jpg: kitesurfing, kite surfing, kite boarding, kiteboarding
- Live_Music.jpg: live music, live bands, jam sessions, open mic
- Local_Culture.jpg: local culture, cultural experiences, cultural immersion, traditions, heritage, cultural exploration
- Local_Food.jpg: local food, street food, local cuisine, foodie, food tours, culinary experiences, cooking
- Longboard(skate).jpg: longboarding, longboard skating, cruising, carving
- Martial_Arts.jpg: martial arts, karate, judo, taekwondo, MMA, boxing, muay thai, jiu jitsu, BJJ
- Mindfullness_Meditation.jpg: mindfulness, meditation, mindful practice, zen, contemplation
- Mobility_Training_Stretching.jpg: mobility, stretching, flexibility, foam rolling, recovery, mobility training
- Mountain_Biking.jpg: mountain biking, MTB, trail riding, downhill biking
- Music_Festivals.jpg: music festivals, festival, coachella, burning man, festival season
- Nature.jpg: nature, outdoors, wilderness, forests, natural beauty, parks, scenery
- Nature_Conservation.jpg: nature conservation, environmental conservation, conservation, eco, sustainability, green living, environment
- Nightlife.jpg: nightlife, parties, partying, going out, clubs, clubbing, bars, nightclub, bar hopping
- Ocean_Conservation.jpg: ocean conservation, marine conservation, save the ocean, ocean cleanup
- Overlanding_Van_Life.jpg: overlanding, van life, camper van, road trip, RV, living in a van
- Paragliding.jpg: paragliding, paraglide, hang gliding
- Photography.jpg: photography, photo, camera, landscape photography, street photography
- Pickleball.jpg: pickleball, paddle sport
- Pilates.jpg: pilates, reformer pilates, mat pilates
- Pingpong.jpg: ping pong, table tennis, pingpong
- Playing_Music.jpg: playing music, guitar, piano, drums, musical instrument, musician, jamming
- Pool_Billiards_Snooker.jpg: pool, billiards, snooker, shooting pool
- Reading.jpg: reading, books, book club, literature
- Rock_Climbing.jpg: rock climbing, climbing, bouldering, sport climbing, indoor climbing
- Rugby.jpg: rugby, rugby union, rugby league
- Running.jpg: running, jogging, trail running, marathon, sprinting, 5K
- SUP_Surfing.jpg: SUP, stand up paddle, paddle boarding, SUP surfing
- Safari_Wild_Animal.jpg: safari, wild animals, wildlife watching, game drive, big five
- Sailing.jpg: sailing, sailboat, yachting, catamaran
- Scuba_Diving.jpg: scuba diving, diving, scuba, underwater diving
- Skateboarding.jpg: skateboarding, skating, skatepark, street skating, kickflip
- Skiing_Snowboarding.jpg: skiing, snowboarding, snow sports, ski resort, powder, slopes
- Skydiving.jpg: skydiving, sky diving, parachuting, base jumping
- Snorkeling.jpg: snorkeling, snorkel, reef snorkeling
- Snowmobiling.jpg: snowmobiling, snowmobile, snow machine
- Soccer.jpg: soccer, football (non-US), futbol, pickup soccer
- Spear_Fishing.jpg: spear fishing, spearfishing, underwater hunting
- Spin_Fishing.jpg: spin fishing, shore fishing, surf fishing, beach fishing
- Swimming.jpg: swimming, swim, laps, pool swimming, open water swimming
- Tennis.jpg: tennis, tennis court, racket sport
- Travel.jpg: travel, traveling, wanderlust, globetrotting, world travel, sightseeing
- Volleyball.jpg: volleyball, beach volleyball, indoor volleyball, spike
- Wakeboarding_Waterskiing.jpg: wakeboarding, water skiing, waterskiing, wake surfing
- Whale_Watching_Dolphin_Watching.jpg: whale watching, dolphin watching, marine life, whale tour
- Wildlife_Conservation.jpg: wildlife conservation, animal conservation, endangered species, wildlife protection
- Wind_Surfing.jpg: windsurfing, wind surfing, sailboarding
- Wing_Foiling.jpg: wing foiling, wing surf, foil surfing, hydrofoil
- Yoga.jpg: yoga, yoga practice, vinyasa, ashtanga, hot yoga, yoga retreat

RULES:
1. Match each keyword to the SINGLE BEST image. Always try to find a match.
2. Only return null if the keyword is truly unrelated to ANY image (very rare).
3. Return ONLY valid JSON: {"keyword1": "Filename.jpg", "keyword2": null, ...}

Keywords to match: ${JSON.stringify(lifestyleKeywords)}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No content in OpenAI response')
  }

  const parsed = JSON.parse(content)
  const validated: Record<string, string | null> = {}
  for (const keyword of lifestyleKeywords) {
    const filename = parsed[keyword]
    validated[keyword] = (typeof filename === 'string' && LIFESTYLE_IMAGE_FILENAMES.has(filename))
      ? filename : null
  }
  return validated
}

/**
 * Fetch a Pexels image for a keyword, download it, upload to the lifestyle-thumbnails
 * bucket, and return the public bucket URL.
 */
async function fetchAndUploadPexelsImage(
  keyword: string,
  supabaseAdmin: any
): Promise<string | null> {
  if (!PEXELS_API_KEY) return null

  // Use GPT to build a better search query
  let searchQuery = keyword
  if (OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You generate short image search queries for a stock photo API. The query should help fetch realistic photos for hobbies, activities, or lifestyle. Return 3-7 words only, no punctuation except spaces.' },
            { role: 'user', content: `Keyword: "${keyword}". Return only the search query.` },
          ],
          temperature: 0.3,
          max_tokens: 50,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content?.trim()
        if (content) {
          searchQuery = content.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || keyword
        }
      }
    } catch (e) {
      console.warn('[backfill-lifestyle-images] GPT query build failed:', e)
    }
  }

  // Search Pexels
  let pexelsImageUrl: string | null = null
  try {
    const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=3&orientation=square`
    const pexelsRes = await fetch(pexelsUrl, {
      headers: { Authorization: PEXELS_API_KEY },
    })
    if (!pexelsRes.ok) return null

    const pexelsData = await pexelsRes.json()
    const photos = pexelsData?.photos
    if (!Array.isArray(photos) || photos.length === 0) return null

    pexelsImageUrl = photos[0]?.src?.medium || photos[0]?.src?.small || null
  } catch (e) {
    console.warn('[backfill-lifestyle-images] Pexels fetch failed for', keyword, e)
    return null
  }

  if (!pexelsImageUrl) return null

  // Download the image
  try {
    const imgResponse = await fetch(pexelsImageUrl)
    if (!imgResponse.ok) return null

    const blob = await imgResponse.blob()
    const mimeType = blob.type || 'image/jpeg'
    let extension = '.jpg'
    if (mimeType.includes('png')) extension = '.png'
    else if (mimeType.includes('webp')) extension = '.webp'

    // Build a safe filename from the keyword: "remote-work" -> "pexels_remote-work.jpg"
    const safeKeyword = keyword.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
    const fileName = `pexels_${safeKeyword}${extension}`

    // Upload to bucket (upsert)
    const uploadResult = await supabaseAdmin.storage
      .from(LIFESTYLE_IMAGES_BUCKET)
      .upload(fileName, blob, {
        contentType: mimeType,
        upsert: true,
      })

    if (uploadResult?.error) {
      console.warn('[backfill-lifestyle-images] Upload failed for', keyword, uploadResult.error.message)
      return null
    }

    const uploadPath = uploadResult?.data?.path
    if (!uploadPath) return null

    // Return public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(LIFESTYLE_IMAGES_BUCKET)
      .getPublicUrl(uploadPath)

    console.log(`[backfill-lifestyle-images] Uploaded Pexels image for "${keyword}" -> ${urlData.publicUrl}`)
    return urlData.publicUrl
  } catch (e) {
    console.warn('[backfill-lifestyle-images] Download/upload failed for', keyword, e)
    return null
  }
}

async function buildImageUrls(
  keywordImageMap: Record<string, string | null>,
  supabaseAdmin: any
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {}
  const pexelsKeywords: string[] = []

  for (const [keyword, filename] of Object.entries(keywordImageMap)) {
    if (filename) {
      const encoded = encodeURIComponent(filename)
      urls[keyword] = `${SUPABASE_URL}/storage/v1/object/public/${LIFESTYLE_IMAGES_BUCKET}/${encoded}`
    } else {
      pexelsKeywords.push(keyword)
    }
  }

  // Fetch Pexels images, upload to bucket, use bucket URLs
  if (pexelsKeywords.length > 0) {
    console.log('[backfill-lifestyle-images] Fetching Pexels for unmatched keywords:', pexelsKeywords)
    const results = await Promise.allSettled(
      pexelsKeywords.map(async (keyword) => {
        const bucketUrl = await fetchAndUploadPexelsImage(keyword, supabaseAdmin)
        return { keyword, url: bucketUrl }
      })
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.url) {
        urls[result.value.keyword] = result.value.url
      }
    }
  }

  return urls
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Fetch all surfers with lifestyle_keywords
    const fetchResult = await supabaseAdmin
      .from('surfers')
      .select('user_id, lifestyle_keywords, lifestyle_image_urls')

    const fetchError = fetchResult?.error
    if (fetchError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch surfers', details: fetchError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const allSurfers = fetchResult?.data ?? []
    const withKeywords = allSurfers.filter(
      (s) => Array.isArray(s.lifestyle_keywords) && s.lifestyle_keywords.length > 0
    )

    console.log(`[backfill-lifestyle-images] Found ${allSurfers.length} surfers, ${withKeywords.length} with lifestyle_keywords`)

    const results: { user_id: string; success: boolean; error?: string }[] = []
    let succeeded = 0
    let failed = 0

    for (const surfer of withKeywords) {
      const user_id = surfer.user_id
      const lifestyleKeywords: string[] = surfer.lifestyle_keywords || []

      try {
        console.log(`[backfill-lifestyle-images] Processing user ${user_id}, keywords:`, lifestyleKeywords)

        const keywordImageMap = await matchLifestyleKeywordsToImages(lifestyleKeywords)
        const imageUrls = await buildImageUrls(keywordImageMap, supabaseAdmin)

        const updateResult = await supabaseAdmin
          .from('surfers')
          .update({ lifestyle_image_urls: imageUrls })
          .eq('user_id', user_id)

        if (updateResult?.error) {
          throw new Error(updateResult.error.message)
        }

        results.push({ user_id, success: true })
        succeeded++
        console.log(`[backfill-lifestyle-images] Updated user ${user_id}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[backfill-lifestyle-images] Failed for user ${user_id}:`, message)
        results.push({ user_id, success: false, error: message })
        failed++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_surfers: allSurfers.length,
        with_lifestyle_keywords: withKeywords.length,
        processed: withKeywords.length,
        succeeded,
        failed,
        results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    )
  } catch (error) {
    console.error('[backfill-lifestyle-images] Error:', error)
    const message = error instanceof Error ? error.message : error != null ? String(error) : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
