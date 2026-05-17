import type { Env } from "../worker/env";
import { handleHeartToggle } from "./handlers";

export async function routeHearts(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/hearts" && request.method === "POST") {
    return handleHeartToggle(request, env);
  }
  return null;
}
