import { createSign } from "node:crypto";

type ServiceAccountConfig = {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

export type V1GoogleSheetSignup = {
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const DEFAULT_V1_GOOGLE_SHEET_ID = "10hT9nQ7QcMoafWhOxG2zXOJJmMS4haaNe0jMh7ZQn6g";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function parseServiceAccountJson(raw: string, source: string): ServiceAccountConfig | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientEmail = stringValue(parsed.client_email);
    const privateKey = stringValue(parsed.private_key)?.replace(/\\n/g, "\n");
    const tokenUri = stringValue(parsed.token_uri) || GOOGLE_TOKEN_URI;

    if (!clientEmail || !privateKey) {
      console.warn(`[v1GoogleSheet] ${source} is missing client_email or private_key`);
      return null;
    }

    return { clientEmail, privateKey, tokenUri };
  } catch (err) {
    console.warn(`[v1GoogleSheet] Failed to parse ${source}:`, err);
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveServiceAccount(): ServiceAccountConfig | null {
  const googleBase64 = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_BASE64;
  if (googleBase64) {
    return parseServiceAccountJson(
      Buffer.from(googleBase64, "base64").toString("utf-8"),
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_BASE64"
    );
  }

  const googleJson = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  if (googleJson) {
    return parseServiceAccountJson(googleJson, "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON");
  }

  const googleClientEmail = stringValue(process.env.GOOGLE_SHEETS_CLIENT_EMAIL);
  const googlePrivateKey = stringValue(process.env.GOOGLE_SHEETS_PRIVATE_KEY)?.replace(/\\n/g, "\n");
  if (googleClientEmail && googlePrivateKey) {
    return {
      clientEmail: googleClientEmail,
      privateKey: googlePrivateKey,
      tokenUri: GOOGLE_TOKEN_URI,
    };
  }

  const firebaseBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (firebaseBase64) {
    return parseServiceAccountJson(
      Buffer.from(firebaseBase64, "base64").toString("utf-8"),
      "FIREBASE_SERVICE_ACCOUNT_BASE64"
    );
  }

  const firebaseJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (firebaseJson) {
    return parseServiceAccountJson(firebaseJson, "FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const firebaseClientEmail = stringValue(process.env.FIREBASE_ADMIN_CLIENT_EMAIL);
  const firebasePrivateKey = stringValue(process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, "\n");
  if (firebaseClientEmail && firebasePrivateKey) {
    return {
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey,
      tokenUri: GOOGLE_TOKEN_URI,
    };
  }

  return null;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createJwt(config: ServiceAccountConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claimSet = base64UrlJson({
    iss: config.clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: config.tokenUri,
    exp: now + 3600,
    iat: now,
  });
  const unsignedJwt = `${header}.${claimSet}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();

  return `${unsignedJwt}.${signer.sign(config.privateKey, "base64url")}`;
}

async function getAccessToken(config: ServiceAccountConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(config.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(config),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Google OAuth token request failed: ${detail}`);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return data.access_token;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function appendV1GoogleSheetSignup(
  signup: V1GoogleSheetSignup
): Promise<"synced" | "skipped"> {
  const serviceAccount = resolveServiceAccount();
  if (!serviceAccount) {
    console.warn("[v1GoogleSheet] Google Sheets credentials missing - V1+ sheet sync skipped");
    return "skipped";
  }

  const spreadsheetId = stringValue(process.env.V1_GOOGLE_SHEET_ID) || DEFAULT_V1_GOOGLE_SHEET_ID;
  const range = stringValue(process.env.V1_GOOGLE_SHEET_RANGE) || "A:H";
  const accessToken = await getAccessToken(serviceAccount);

  const values = [
    [
      "=ROW()-1",
      signup.firstName ?? "",
      signup.lastName ?? "",
      signup.fullName ?? "",
      signup.email,
      todayIsoDate(),
      "Yes",
      "No",
    ],
  ];

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}:append`
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Sheets append failed: HTTP ${res.status} ${detail.slice(0, 400)}`);
  }

  return "synced";
}
