/**
 * GET /api/download?token=<key>.<sig> — signed download link sent with each license.
 *
 * Verifies the token, checks the license is still active, then streams
 * `asset:starter.zip` from the `LICENSES` KV namespace (or redirects to
 * LICENSE_DOWNLOAD_URL when that is set).
 */
import { type LicenseEnv, getLicense, verifyDownloadToken } from "../../lib/license";

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export const onRequestGet: PagesFunction<LicenseEnv> = async ({ request, env }) => {
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !env.LICENSES) return text(503, "Downloads are temporarily unavailable. Email hello@agentwright.app.");

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const key = await verifyDownloadToken(token, secret);
  if (!key) return text(403, "This download link is not valid.");

  const license = await getLicense(env.LICENSES, key);
  if (!license || license.status !== "active") return text(403, "This license is no longer active.");

  if (env.LICENSE_DOWNLOAD_URL) return Response.redirect(env.LICENSE_DOWNLOAD_URL, 302);

  const zip = await env.LICENSES.get("asset:starter.zip", "arrayBuffer");
  if (!zip) return text(503, "The download is being prepared. Email hello@agentwright.app and we'll send it by hand.");

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="agentwright-starter.zip"',
      "cache-control": "private, no-store",
    },
  });
};
