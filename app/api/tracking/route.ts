import { env } from 'cloudflare:workers';
import { handleTracking } from '../../../lib/tracking.mjs';
export async function GET(request: Request) { return handleTracking(request, env.DB); }
export async function POST(request: Request) { return handleTracking(request, env.DB); }
export async function OPTIONS(request: Request) { return handleTracking(request, env.DB); }
