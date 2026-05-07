import { head } from "@vercel/blob";
import { GAMES_VERSION_BLOB_PATH } from "@/app/lib/games-version-blob";

export const dynamic = "force-dynamic";

export async function GET() {
  let version = "0";
  try {
    const meta = await head(GAMES_VERSION_BLOB_PATH);
    version = String(meta.uploadedAt.getTime());
  } catch {
    // no version blob yet — fall through to "0"
  }
  return Response.json(
    { version },
    {
      headers: { "cache-control": "no-store, must-revalidate" },
    },
  );
}
