/**
 * Business time zone. Server-rendered dates (PDF reports, public summary pages)
 * run on Vercel in UTC, so they must pass this explicitly. Arizona has no DST.
 */
export const APP_TIME_ZONE = "America/Phoenix";
