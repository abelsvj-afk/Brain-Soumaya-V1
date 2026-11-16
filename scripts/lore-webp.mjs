#!/usr/bin/env node
/**
 * Lore art: PNG original -> web-sized WebP for the Book (Item 5).
 *
 *   node scripts/lore-webp.mjs <entry-id> <source-png> [<entry-id> <source-png> ...]
 *
 * Writes packages/web/public/lore/<entry-id>.webp at 1024 px wide, WebP quality 80 —
 * the same web-sized shape the Book's STORY_ART rows point at (see the storyArt.ts
 * header: a few dozen KB each, never the ~2 MB originals; storyArt.test.ts enforces
 * <150 KB). The PNG originals stay where they are (docs/lore/art/); only the WebP
 * ships in the app.
 *
 * Conversion uses `sharp` from node_modules (transitive today, via
 * @huggingface/transformers). Nothing is installed by this script: if sharp is
 * not resolvable it fails loudly with the Pillow one-liner as the fallback.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 150 * 1024;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length % 2 !== 0) {
    console.error("usage: node scripts/lore-webp.mjs <entry-id> <source-png> [<entry-id> <source-png> ...]");
    process.exit(2);
  }
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "sharp is not resolvable from node_modules — install nothing new, use Pillow instead:\n" +
        "  python3 -c \"from PIL import Image; im = Image.open('<src>'); im.thumbnail((1024, 1024)); im.save('<out>', 'WEBP', quality=80)\"",
    );
    process.exit(1);
  }
  const webDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "packages/web/public/lore");
  for (let i = 0; i < args.length; i += 2) {
    const [entryId, src] = [args[i], args[i + 1]];
    const out = resolve(webDir, `${entryId}.webp`);
    const info = await sharp(src).resize({ width: 1024, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
    const size = statSync(out).size;
    if (size > MAX_BYTES) {
      console.error(`${entryId}: ${size} bytes — over the ${MAX_BYTES} byte web-size limit, lower the quality`);
      process.exit(1);
    }
    console.log(`${entryId}: ${out} — ${info.width}x${info.height}, ${Math.round(size / 1024)} KB`);
  }
}

await main();
