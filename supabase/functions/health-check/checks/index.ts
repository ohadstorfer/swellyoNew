import type { Check } from "../types.ts";
import { dbCheck } from "./db.ts";
import { authCheck } from "./auth.ts";
import { openaiCheck } from "./openai.ts";
import { s3Check } from "./s3.ts";
import { storageCheck } from "./storage.ts";
import { realtimeCheck } from "./realtime.ts";
import { googleGeocodeCheck } from "./google.ts";
import { expoPushCheck } from "./expo.ts";
import { edgeFunctionsCheck } from "./edgeFunctions.ts";
import { matchingCheck } from "./matching.ts";

export function buildAllChecks(): Check[] {
  return [
    dbCheck(),
    authCheck(),
    openaiCheck(),
    s3Check(),
    storageCheck(),
    realtimeCheck(),
    googleGeocodeCheck(),
    expoPushCheck(),
    edgeFunctionsCheck(),
    matchingCheck(),
  ];
}
