# Password recovery deployment

The frontend is Vite/React, so its public URL variable is `VITE_PUBLIC_SITE_URL` (not `NEXT_PUBLIC_SITE_URL`). It is used only to build the fixed `/reset-password` email destination and is never inferred from the browser host, request headers, or query parameters.

## Supabase Authentication → URL Configuration

Set **Site URL** to the canonical production URL:

`https://your-project.vercel.app`

Add these **Redirect URLs** (replace the example host):

- `http://localhost:3000/reset-password`
- `https://your-project.vercel.app/reset-password`
- `https://*-your-vercel-team.vercel.app/reset-password` (only if preview deployments need recovery emails)
- `https://www.your-custom-domain.com/reset-password` (add this before making it canonical)

Supabase wildcard syntax should be checked against the dashboard help text for the project before relying on preview support. Keep the list as narrow as practical.

Under **Authentication → Email/Password**, set the email OTP/recovery expiry to **900 seconds (15 minutes)**. Supabase, rather than browser code, enforces expiry and single use. Configure a production SMTP provider and customize the recovery email template to use Supabase's `{{ .ConfirmationURL }}`. Do not place reset tokens in a database table or logs.

## Vercel

Set these for Production, Preview (if preview recovery is enabled), and Development as appropriate:

- `VITE_PUBLIC_SUPABASE_URL`
- `VITE_PUBLIC_SUPABASE_ANON_KEY` (the public/publishable key only)
- `VITE_PUBLIC_SITE_URL=https://your-project.vercel.app` for Production

For local `npm run dev`, omit `VITE_PUBLIC_SITE_URL` to use `http://localhost:3000`, or set it explicitly to that value. This repository's `vercel.json` supplies direct-route SPA fallbacks and `no-store`/no-referrer headers for the sensitive recovery screens.
