This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

## Environment Variables

Create a local `.env.local` before running the app with:

```bash
OPENWEATHER_API_KEY=your_openweather_api_key
```

For production, add the same variable in your Vercel project settings:

- `Settings` -> `Environment Variables`
- Name: `OPENWEATHER_API_KEY`
- Environments: at least `Production` and usually `Preview` too

Keep this key server-side only. Do not expose it as `NEXT_PUBLIC_*`.

### V1+ Google Sheet sync

When a paid member turns on the V1+ Virtual Coaching benefit, the app appends a row to:

```text
https://docs.google.com/spreadsheets/d/10hT9nQ7QcMoafWhOxG2zXOJJmMS4haaNe0jMh7ZQn6g
```

The default row shape matches the current customer sheet:

```text
# | First Name | Last Name | Full Name | Email | Date Enabled | Active @ Mullly? | Active @ V1+?
```

Configure server-side Google credentials with one of these options:

```bash
GOOGLE_SHEETS_SERVICE_ACCOUNT_BASE64=base64_encoded_service_account_json
# or
GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"..."}
# or
GOOGLE_SHEETS_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If those are not present, the sync falls back to the Firebase service account env vars already used by the app. Share the Google Sheet with the service account `client_email` as an editor, and make sure the Google Sheets API is enabled in that Google Cloud project.

Optional overrides:

```bash
V1_GOOGLE_SHEET_ID=10hT9nQ7QcMoafWhOxG2zXOJJmMS4haaNe0jMh7ZQn6g
V1_GOOGLE_SHEET_RANGE=A:H
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
