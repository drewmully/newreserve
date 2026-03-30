import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(url = "http://localhost/api/weather?lat=40.7128&lon=-74.006"): NextRequest {
  return new NextRequest(url, { method: "GET" });
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
            weather: [{ description: "clear sky", icon: "01d" }],
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
      uvIndex: 0,
      locationName: "New York",
      locationCountry: "US",
      requestedLat: 40.7128,
      requestedLon: -74.006,
      dataSource: "live",
    });
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
});
