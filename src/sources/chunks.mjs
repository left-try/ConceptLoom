import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");

export function chunkSource({ sourceUid, contentHash, sections = [], maxChars = 1800, representation = "raw", coverage = "full" }) {
  if (!contentHash || ["metadata", "summary"].includes(representation) || ["metadata", "summary", "unknown"].includes(coverage)) return [];
  const chunks = [];
  for (const section of sections) {
    const paragraphs = String(section.text ?? "").split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
    let parts = [], size = 0;
    const flush = () => {
      if (!parts.length) return;
      const text = parts.join("\n\n");
      const locator = { ...(section.locator ?? {}) };
      for (const key of ["page", "printedPage", "heading", "start", "end"]) if (section[key] !== undefined && locator[key] === undefined) locator[key] = section[key];
      locator.sourceUid = sourceUid; locator.contentHash = contentHash;
      chunks.push({ id: hash(`${sourceUid}\0${contentHash}\0${section.heading ?? ""}\0${chunks.length}\0${text}`), sourceUid, contentHash, text, locator });
      parts = []; size = 0;
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length > maxChars) {
        flush();
        for (let i = 0; i < paragraph.length; i += maxChars) {
          const text = paragraph.slice(i, i + maxChars);
          const locator = { ...(section.locator ?? {}), ...(section.page !== undefined ? { page: section.page } : {}), sourceUid, contentHash };
          chunks.push({ id: hash(`${sourceUid}\0${contentHash}\0${section.heading ?? ""}\0${i}\0${text}`), sourceUid, contentHash, text, locator });
        }
      } else if (size + paragraph.length + (parts.length ? 2 : 0) > maxChars) { flush(); parts.push(paragraph); size = paragraph.length; }
      else { parts.push(paragraph); size += paragraph.length + (parts.length > 1 ? 2 : 0); }
    }
    flush();
  }
  return chunks;
}
