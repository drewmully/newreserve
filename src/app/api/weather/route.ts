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

// In-memory cache (per serverless instance)
const cache = new Map<string, { data: unknown; expires: number }>();

type WeatherSuccess = {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  windSpeed: number;
  humidity: number;
  uvIndex: number;
  sunrise: string;
  sunset: string;
  golfScore: number;
};

function parseCoordinate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function computeGolfScore(temp: number, wind: number, humidity: number, uvIndex: number): number {
  let score = 10;
  if (temp < 50) score -= 3;
  else if (temp < 60) score -= 1.5;
  else if (temp > 90) score -= 2.5;
  else if (temp > 85) score -= 1;
  if (wind > 25) score -= 3;
  else if (wind > 15) score -= 1.5;
  else if (wind > 10) score -= 0.5;
  if (humidity > 85) score -= 1;
  if (uvIndex > 8) score -= 0.5;
  return Math.max(1, Math.min(10, Math.round(score)));
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
  const { searchParams } = new URL(request.url);
  const lat = parseCoordinate(searchParams.get("lat"));
  const lon = parseCoordinate(searchParams.get("lon"));

  if (lat === null || lon === null) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

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
      weather?: Array<{ description?: string; icon?: string }>;
      wind: { speed: number };
      sys: { sunrise: number; sunset: number };
      timezone: number;
    };
    const primaryCondition = weather.weather?.[0];
    let uvIndex = 0;
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
      golfScore: computeGolfScore(
        weather.main.temp,
        weather.wind.speed,
        weather.main.humidity,
        uvIndex
      ),
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
