import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(
  url = "http://localhost/api/weather?lat=40.7128&lon=-74.006",
  headers?: HeadersInit
): NextRequest {
  return new NextRequest(url, { method: "GET", headers });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/weather/route");
}

describe("GET /api/weather", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns mock data when OPENWEATHER_API_KEY is missing", async () => {
    delete process.env.OPENWEATHER_API_KEY;

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      temp: 72,
      feelsLike: 70,
      condition: "Partly Cloudy",
      golfScore: 9,
      locationName: "New York",
      locationCountry: "US",
      requestedLat: 40.7128,
      requestedLon: -74.006,
      dataSource: "mock",
      locationSource: "query",
      golfSummary: "Demo data only. Real scoring needs a live weather key.",
    });
  });

  it("trims the API key and still returns weather data when UV fails", async () => {
    process.env.OPENWEATHER_API_KEY = "  test-key  ";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            main: { temp: 74.4, feels_like: 75.2, humidity: 51 },
            weather: [{ main: "Clear", description: "clear sky", icon: "01d" }],
            wind: { speed: 9.6 },
            sys: { sunrise: 1711789320, sunset: 1711834500, country: "US" },
            timezone: -14400,
            name: "New York",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cod: 404, message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("appid=test-key");
    expect(json).toMatchObject({
      temp: 74,
      feelsLike: 75,
      condition: "Clear Sky",
      windSpeed: 10,
      humidity: 51,
      uvIndex: null,
      locationName: "New York",
      locationCountry: "US",
      requestedLat: 40.7128,
      requestedLon: -74.006,
      dataSource: "live",
      locationSource: "query",
    });
    expect(json.golfScore).toBeGreaterThanOrEqual(8);
    expect(json.golfSummary).toContain("Ideal for a round.");
  });

  it("returns 502 when OpenWeather current weather fails", async () => {
    process.env.OPENWEATHER_API_KEY = "test-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cod: 401, message: "Invalid API key" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({
      error: "Weather upstream request failed",
      code: "weather_upstream_failed",
    });
  });

  it("uses Vercel IP coordinates when browser coordinates are not provided", async () => {
    process.env.OPENWEATHER_API_KEY = "test-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            main: { temp: 65, feels_like: 65, humidity: 58 },
            weather: [{ main: "Clouds", description: "few clouds", icon: "02d" }],
            wind: { speed: 7 },
            sys: { sunrise: 1711789320, sunset: 1711834500, country: "US" },
            timezone: -14400,
            name: "Chicago",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 6 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await loadRoute();
    const res = await GET(
      makeRequest("http://localhost/api/weather", {
        "x-vercel-ip-latitude": "41.8781",
        "x-vercel-ip-longitude": "-87.6298",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      locationName: "Chicago",
      locationSource: "vercel-ip",
      requestedLat: 41.8781,
      requestedLon: -87.6298,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("lat=41.8781&lon=-87.6298");
  });

  it("heavily penalizes thunderstorm and rain conditions", async () => {
    process.env.OPENWEATHER_API_KEY = "test-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            main: { temp: 73, feels_like: 75, humidity: 88 },
            weather: [{ main: "Thunderstorm", description: "thunderstorm with rain", icon: "11d" }],
            wind: { speed: 21, gust: 29 },
            rain: { "1h": 2.8 },
            visibility: 2500,
            sys: { sunrise: 1711789320, sunset: 1711834500, country: "US" },
            timezone: -14400,
            name: "Atlanta",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 9 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await loadRoute();
    const res = await GET(makeRequest("http://localhost/api/weather?lat=33.749&lon=-84.388"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.golfScore).toBeLessThanOrEqual(3);
    expect(json.golfSummary).toContain("thunderstorm risk");
  });
});
