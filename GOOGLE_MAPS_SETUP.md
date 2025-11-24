# Google Maps Setup Guide for GA Eats

This guide walks you through setting up Google Maps JavaScript API for the GA Eats application.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Create Google Cloud Project](#step-1-create-google-cloud-project)
- [Step 2: Enable Required APIs](#step-2-enable-required-apis)
- [Step 3: Create API Key](#step-3-create-api-key)
- [Step 4: Configure API Key Restrictions](#step-4-configure-api-key-restrictions)
- [Step 5: Configure Environment Variables](#step-5-configure-environment-variables)
- [Pricing & Billing](#pricing--billing)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Google Cloud account (free to create)
- Credit card (required for API access, but $200/month free credit applies)

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: `ga-eats` (or your preferred name)
4. Click "Create"

## Step 2: Enable Required APIs

Navigate to [APIs & Services > Library](https://console.cloud.google.com/apis/library)

Enable the following APIs:

### Required APIs

1. **Maps JavaScript API**
   - Used for: Displaying the interactive map
   - Search for "Maps JavaScript API" → Click "Enable"

2. **Directions API**
   - Used for: Calculating routes and turn-by-turn directions
   - Search for "Directions API" → Click "Enable"

3. **Places API (New)**
   - Used for: Future feature - syncing restaurant data
   - Search for "Places API (New)" → Click "Enable"

### Optional APIs

4. **Street View Static API**
   - Used for: Street View integration
   - Search for "Street View Static API" → Click "Enable"

5. **Geocoding API**
   - Used for: Converting addresses to coordinates
   - Search for "Geocoding API" → Click "Enable"

## Step 3: Create API Key

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click "+ CREATE CREDENTIALS" → "API key"
3. Your new API key will be created and displayed
4. **Copy this key** - you'll need it for environment variables

## Step 4: Configure API Key Restrictions

**⚠️ IMPORTANT**: Never deploy an unrestricted API key to production!

### For Development

1. Click on your API key to edit it
2. Under "Application restrictions", select "None" (temporary)
3. Under "API restrictions":
   - Select "Restrict key"
   - Check only the APIs you enabled above
4. Click "Save"

### For Production

1. Edit your API key
2. Under "Application restrictions", select "HTTP referrers (web sites)"
3. Add your production domains:
   ```
   https://yourdomain.com/*
   https://www.yourdomain.com/*
   ```
4. Under "API restrictions":
   - Select "Restrict key"
   - Check only required APIs
5. Click "Save"

### For Cloudflare Workers (Server-side)

Create a **separate API key** for server-side operations:

1. Create new API key
2. Name it "GA Eats Server Key"
3. Restrict to only: **Places API (New)**
4. Under "Application restrictions", select "None" (server-side keys don't need HTTP restrictions)
5. **Store securely** using `wrangler secret put GOOGLE_PLACES_API_KEY`

## Step 5: Configure Environment Variables

### Local Development

1. Copy `.env.template` to `.env`:
   ```bash
   cp .env.template .env
   ```

2. Edit `.env` and add your API key:
   ```env
   # Client-side (web app)
   VITE_GOOGLE_MAPS_API_KEY="YOUR_API_KEY_HERE"

   # Server-side (Cloudflare Workers)
   GOOGLE_PLACES_API_KEY="YOUR_SERVER_API_KEY_HERE"
   ```

3. **Never commit `.env`** to version control (it's already in `.gitignore`)

### Production (Cloudflare Workers)

Set secrets using Wrangler CLI:

```bash
# Client-side key (will be exposed to browser)
wrangler secret put VITE_GOOGLE_MAPS_API_KEY
# Paste your restricted client-side API key

# Server-side key (for Places API sync worker)
wrangler secret put GOOGLE_PLACES_API_KEY
# Paste your server-side API key
```

## Pricing & Billing

### Free Tier (as of 2025)

- **$200 monthly credit** for all Google Maps Platform services
- Credit applies automatically to all API usage
- No charges until you exceed $200/month

### Cost Estimates for GA Eats

Based on typical usage:

| API | Usage | Cost (per 1,000) | Monthly Estimate |
|-----|-------|------------------|------------------|
| Maps JavaScript API | Dynamic map loads | $7.00 | ~$35 for 5,000 loads |
| Directions API | Route calculations | $5.00 | ~$25 for 5,000 requests |
| Places API (New) | Monthly sync (5,200 airports) | $35.00 | $182 (one-time monthly) |

**Total estimated monthly cost**: ~$242

**Net cost after $200 credit**: ~$42/month

### Monitoring Usage

1. Go to [Google Cloud Console > Billing](https://console.cloud.google.com/billing)
2. Select your project
3. View "Reports" to see API usage
4. Set up budget alerts:
   - Go to "Budgets & alerts"
   - Create budget (e.g., $200/month)
   - Set alert thresholds (50%, 90%, 100%)

## Testing

### Test Your API Key

1. Start the development server:
   ```bash
   pnpm dev
   ```

2. Navigate to http://localhost:5173/map

3. You should see:
   - ✅ Google Maps loads
   - ✅ Markers appear for restaurants/airports
   - ✅ Map controls (zoom, street view) work
   - ✅ Clicking markers shows directions panel

### Common Issues

**"Google Maps JavaScript API error: RefererNotAllowedMapError"**
- Your API key has HTTP referrer restrictions
- For development, temporarily remove restrictions
- Or add `http://localhost:5173/*` to allowed referrers

**"This page can't load Google Maps correctly"**
- API key is missing or invalid
- Check `.env` file has correct `VITE_GOOGLE_MAPS_API_KEY`
- Verify API key is enabled in Google Cloud Console

**"This API project is not authorized to use this API"**
- Required API not enabled in Google Cloud Console
- Go back to Step 2 and enable all required APIs

## Security Best Practices

### ✅ Do:

- Use separate API keys for client-side and server-side
- Restrict client-side keys to specific HTTP referrers
- Restrict keys to only needed APIs
- Monitor usage regularly
- Set up budget alerts
- Rotate keys periodically

### ❌ Don't:

- Commit API keys to version control
- Use unrestricted keys in production
- Share API keys publicly
- Use the same key for all environments

## Advanced: Custom Map Styling

You can customize the map appearance using Map IDs:

1. Go to [Cloud Console > Maps > Map Styles](https://console.cloud.google.com/google/maps-apis/studio/maps)
2. Create a new map style
3. Customize colors, labels, features
4. Copy the Map ID
5. Update `GoogleMapComponent.tsx`:
   ```tsx
   <Map
     mapId="YOUR_CUSTOM_MAP_ID"
     // ... other props
   />
   ```

## Need Help?

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [Google Maps Platform Support](https://developers.google.com/maps/support)
- [Stack Overflow - google-maps](https://stackoverflow.com/questions/tagged/google-maps)

---

**Last Updated**: November 2024
**Version**: 1.0
