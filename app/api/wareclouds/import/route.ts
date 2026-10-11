import { handleImport } from '../../../../lib/wareclouds.mjs';
export async function POST(request: Request) { return handleImport(request); }
export async function OPTIONS(request: Request) { return handleImport(request); }
