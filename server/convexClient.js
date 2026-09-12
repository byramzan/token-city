// Server-side Convex access for Vercel Functions.
//
// The durable chain state lives in Convex; Vercel Functions are the HTTP and
// admin-session surface in front of it. Server-to-server calls carry
// CHAIN_SERVICE_SECRET, which never leaves the server environment.

import { ConvexHttpClient } from 'convex/browser';

let cached = null;

export function convexUrl() {
  const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Convex deployment URL is not configured (set CONVEX_URL)');
  return url;
}

export function convexClient() {
  if (!cached) cached = new ConvexHttpClient(convexUrl());
  return cached;
}

export function chainServiceSecret() {
  const secret = process.env.CHAIN_SERVICE_SECRET;
  if (!secret) throw new Error('CHAIN_SERVICE_SECRET is not configured');
  return secret;
}
