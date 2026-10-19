import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/** Sends visitors who already have a valid session away from /login and /signup. */
export async function RedirectIfSignedIn() {
  if (await getSession()) redirect("/");
  return null;
}
