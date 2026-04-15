import { isIP } from "net";

const CLIENT_IP_HEADERS = [
  "x-forwarded-for",
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
];

function normalizeIpCandidate(value: string): string | undefined {
  let candidate = value.trim().replace(/^"|"$/g, "");
  if (!candidate || candidate.toLowerCase() === "unknown") return undefined;

  candidate = candidate.replace(/^for=/i, "").split(";")[0].trim();

  const bracketedIpv6 = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) {
    candidate = bracketedIpv6[1];
  } else {
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)$/);
    if (ipv4WithPort) {
      candidate = ipv4WithPort[1];
    }
  }

  return isIP(candidate) ? candidate : undefined;
}

function firstValidIpFromList(value: string): string | undefined {
  for (const part of value.split(",")) {
    const ip = normalizeIpCandidate(part);
    if (ip) return ip;
  }
  return undefined;
}

function firstValidForwardedIp(value: string): string | undefined {
  for (const part of value.split(",")) {
    const match = part.match(/(?:^|;)\s*for=("[^"]+"|[^;,\s]+)/i);
    if (!match) continue;

    const ip = normalizeIpCandidate(match[1]);
    if (ip) return ip;
  }
  return undefined;
}

export function getClientIp(headers: Headers): string | undefined {
  for (const header of CLIENT_IP_HEADERS) {
    const value = headers.get(header);
    if (!value) continue;

    const ip = firstValidIpFromList(value);
    if (ip) return ip;
  }

  const forwarded = headers.get("forwarded");
  return forwarded ? firstValidForwardedIp(forwarded) : undefined;
}
