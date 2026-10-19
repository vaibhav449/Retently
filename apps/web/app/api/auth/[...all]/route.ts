import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Every /api/auth/* request (sign-up, sign-in, sign-out, get-session) goes to Better Auth.
export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);
