import { NextRequest, NextResponse } from "next/server";

/**
 * Weather API proxy — fetches current conditions from OpenWeatherMap
 * and computes a Golf-ability Score.
 *
 * Query params: ?lat=42.5&lon=-83.2
 *
 * Caches responses for 30 minutes to stay within free-tier limits.
 */

const API_KEY = process.env.OPENWEATHER_API_KEY?.trim();
const DEFAULT_WEATHER_COORDS = { lat: 40.7128, lon: -74.006 };

// In-memory cache (per serverless instance)
const cache = new Map<string, { data: unknown; expires: number }>();

type WeatherLocationSource = "query" | "vercel-ip" | "default";

type WeatherSuccess = {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  windSpeed: number;
  humidity: number;
  uvIndex: number | null;
  sunrise: string;
  sunset: string;
  golfScore: number;
  locationName: string;
  locationCountry: string | null;
  requestedLat: number;
  requestedLon: number;
  dataSource: "live" | "mock";
  locationSource: WeatherLocationSource;
  golfSummary: string;
};

type ResolvedCoords = {
  lat: number;
  lon: number;
  locationSource: WeatherLocationSource;
};

type GolfabilityInput = {
  temp: number;
  feelsLike: number;
  wind: number;
  gust?: number;
  humidity: number;
  uvIndex: number | null;
  conditionMain?: string;
  conditionDescription?: string;
  visibility?: number;
  rain1h?: number;
  snow1h?: number;
};

type GolfabilityResult = {
  score: number;
  summary: string;
};

function parseCoordinate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCoords(request: NextRequest): ResolvedCoords {
  const { searchParams } = new URL(request.url);
  const queryLat = parseCoordinate(searchParams.get("lat"));
  const queryLon = parseCoordinate(searchParams.get("lon"));

  if (queryLat !== null && queryLon !== null) {
    return {
      lat: queryLat,
      lon: queryLon,
      locationSource: "query",
    };
  }

  const headerLat = parseCoordinate(request.headers.get("x-vercel-ip-latitude"));
  const headerLon = parseCoordinate(request.headers.get("x-vercel-ip-longitude"));

  if (headerLat !== null && headerLon !== null) {
    return {
      lat: headerLat,
      lon: headerLon,
      locationSource: "vercel-ip",
    };
  }

  return {
    lat: DEFAULT_WEATHER_COORDS.lat,
    lon: DEFAULT_WEATHER_COORDS.lon,
    locationSource: "default",
  };
}

async function getJsonBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function computeGolfability({
  temp,
  feelsLike,
  wind,
  gust,
  humidity,
  uvIndex,
  conditionMain,
  conditionDescription,
  visibility,
  rain1h,
  snow1h,
}: GolfabilityInput): GolfabilityResult {
  let score = 10;
  const negatives: string[] = [];
  const positives: string[] = [];
  const effectiveTemp = Number.isFinite(feelsLike) ? feelsLike : temp;
  const effectiveWind = Math.max(wind, gust ?? 0);
  const main = (conditionMain ?? "").toLowerCase();
  const description = (conditionDescription ?? "").toLowerCase();

  if (effectiveTemp < 40) {
    score -= 4;
    negatives.push("very cold air");
  } else if (effectiveTemp < 50) {
    score -= 2.5;
    negatives.push("cool temperatures");
  } else if (effectiveTemp < 60) {
    score -= 1;
    negatives.push("chilly conditions");
  } else if (effectiveTemp > 100) {
    score -= 4;
    negatives.push("extreme heat");
  } else if (effectiveTemp > 95) {
    score -= 3;
    negatives.push("oppressive heat");
  } else if (effectiveTemp > 88) {
    score -= 1.5;
    negatives.push("hot conditions");
  } else {
    positives.push("comfortable temperatures");
  }

  if (main.includes("thunder") || description.includes("thunder")) {
    score -= 5;
    negatives.push("thunderstorm risk");
  } else if (snow1h && snow1h > 0) {
    score -= 4.5;
    negatives.push("snow or ice");
  } else if (rain1h && rain1h >= 1.5) {
    score -= 4;
    negatives.push("steady rain");
  } else if ((rain1h && rain1h > 0) || main.includes("rain") || main.includes("drizzle")) {
    score -= 2.5;
    negatives.push("wet conditions");
  }

  if (effectiveWind >= 30) {
    score -= 4;
    negatives.push("very strong wind");
  } else if (effectiveWind >= 22) {
    score -= 2.5;
    negatives.push("windy conditions");
  } else if (effectiveWind >= 15) {
    score -= 1.5;
    negatives.push("breezy conditions");
  } else if (effectiveWind >= 10) {
    score -= 0.5;
    negatives.push("noticeable wind");
  } else {
    positives.push("light wind");
  }

  if (visibility !== undefined) {
    if (visibility < 1000) {
      score -= 3;
      negatives.push("poor visibility");
    } else if (visibility < 3000) {
      score -= 2;
      negatives.push("reduced visibility");
    } else if (visibility < 6000) {
      score -= 1;
      negatives.push("hazy air");
    }
  } else if (
    main.includes("mist") ||
    main.includes("fog") ||
    main.includes("haze") ||
    description.includes("mist") ||
    description.includes("fog") ||
    description.includes("haze") ||
    description.includes("smoke")
  ) {
    score -= 1.5;
    negatives.push("limited visibility");
  }

  if (humidity > 92 && effectiveTemp > 80) {
    score -= 1;
    negatives.push("muggy air");
  } else if (humidity > 85 && effectiveTemp > 85) {
    score -= 0.5;
    negatives.push("sticky humidity");
  } else if (humidity < 80) {
    positives.push("dry air");
  }

  if (uvIndex !== null) {
    if (uvIndex > 10) {
      score -= 1;
      negatives.push("very high UV");
    } else if (uvIndex > 8) {
      score -= 0.5;
      negatives.push("high UV");
    }
  }

  const clampedScore = Math.max(1, Math.min(10, Math.round(score)));
  let summary: string;

  if (clampedScore >= 9) {
    summary = "Ideal for a round.";
  } else if (clampedScore >= 7) {
    summary = "Playable with good overall conditions.";
  } else if (clampedScore >= 5) {
    summary = "Playable, but conditions are mixed.";
  } else if (clampedScore >= 3) {
    summary = "Tough conditions for most players.";
  } else {
    summary = "Poor weather for a comfortable round.";
  }

  const headlineFactor = negatives[0] ?? positives[0];
  if (headlineFactor) {
    summary = `${summary} Biggest factor: ${headlineFactor}.`;
  }

  return {
    score: clampedScore,
    summary,
  };
}

function formatTime(unix: number, timezoneOffset: number): string {
  const date = new Date((unix + timezoneOffset) * 1000);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

export async function GET(request: NextRequest) {
  const { lat, lon, locationSource } = resolveCoords(request);

  if (!API_KEY) {
    // Return mock data if no API key configured
    return NextResponse.json({
      temp: 72,
      feelsLike: 70,
      condition: "Partly Cloudy",
      icon: "02d",
      windSpeed: 8,
      humidity: 45,
      uvIndex: 5,
      sunrise: "6:42 AM",
      sunset: "8:15 PM",
      golfScore: 9,
      locationName: "New York",
      locationCountry: "US",
      requestedLat: lat,
      requestedLon: lon,
      dataSource: "mock",
      locationSource,
      golfSummary: "Demo data only. Real scoring needs a live weather key.",
    });
  }

  // Check cache
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch weather + UV in parallel
    const [weatherRes, uvRes] = await Promise.all([
      fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=imperial`
      ),
      fetch(
        `https://api.openweathermap.org/data/2.5/uvi?lat=${lat}&lon=${lon}&appid=${API_KEY}`
      ).catch(() => null),
    ]);

    if (!weatherRes.ok) {
      const errorBody = await getJsonBody(weatherRes);
      console.error("[Weather API] OpenWeather current weather failed", {
        status: weatherRes.status,
        lat,
        lon,
        body: errorBody,
      });
      return NextResponse.json(
        { error: "Weather upstream request failed", code: "weather_upstream_failed" },
        { status: 502 }
      );
    }

    const weather = (await weatherRes.json()) as {
      main: { temp: number; feels_like: number; humidity: number };
      weather?: Array<{ main?: string; description?: string; icon?: string }>;
      wind: { speed: number; gust?: number };
      rain?: { "1h"?: number; "3h"?: number };
      snow?: { "1h"?: number; "3h"?: number };
      visibility?: number;
      sys: { sunrise: number; sunset: number; country?: string };
      timezone: number;
      name?: string;
    };
    const primaryCondition = weather.weather?.[0];
    const golfability = computeGolfability({
      temp: weather.main.temp,
      feelsLike: weather.main.feels_like,
      wind: weather.wind.speed,
      gust: weather.wind.gust,
      humidity: weather.main.humidity,
      uvIndex: null,
      conditionMain: primaryCondition?.main,
      conditionDescription: primaryCondition?.description,
      visibility: weather.visibility,
      rain1h: weather.rain?.["1h"] ?? weather.rain?.["3h"],
      snow1h: weather.snow?.["1h"] ?? weather.snow?.["3h"],
    });
    let uvIndex: number | null = null;
    if (uvRes?.ok) {
      const uvData = await uvRes.json();
      uvIndex = Math.round(uvData.value ?? 0);
    } else if (uvRes) {
      const uvErrorBody = await getJsonBody(uvRes);
      console.warn("[Weather API] OpenWeather UV request failed", {
        status: uvRes.status,
        lat,
        lon,
        body: uvErrorBody,
      });
    }

    const golfabilityWithUv = uvIndex === null
      ? golfability
      : computeGolfability({
          temp: weather.main.temp,
          feelsLike: weather.main.feels_like,
          wind: weather.wind.speed,
          gust: weather.wind.gust,
          humidity: weather.main.humidity,
          uvIndex,
          conditionMain: primaryCondition?.main,
          conditionDescription: primaryCondition?.description,
          visibility: weather.visibility,
          rain1h: weather.rain?.["1h"] ?? weather.rain?.["3h"],
          snow1h: weather.snow?.["1h"] ?? weather.snow?.["3h"],
        });

    const data: WeatherSuccess = {
      temp: Math.round(weather.main.temp),
      feelsLike: Math.round(weather.main.feels_like),
      condition: primaryCondition?.description
        ? primaryCondition.description.replace(/\b\w/g, (c: string) => c.toUpperCase())
        : "Unknown",
      icon: primaryCondition?.icon ?? "01d",
      windSpeed: Math.round(weather.wind.speed),
      humidity: weather.main.humidity,
      uvIndex,
      sunrise: formatTime(weather.sys.sunrise, weather.timezone),
      sunset: formatTime(weather.sys.sunset, weather.timezone),
      golfScore: golfabilityWithUv.score,
      locationName: weather.name?.trim() || "Unknown area",
      locationCountry: weather.sys.country ?? null,
      requestedLat: lat,
      requestedLon: lon,
      dataSource: "live",
      locationSource,
      golfSummary: golfabilityWithUv.summary,
    };

    // Cache for 30 minutes
    cache.set(cacheKey, { data, expires: Date.now() + 30 * 60 * 1000 });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[Weather API]", err);
    return NextResponse.json(
      { error: "Failed to fetch weather", code: "weather_internal_error" },
      { status: 500 }
    );
  }
}
