export function chunkSource({ sourceUid, contentHash, sections, maxChars = 4000 }) {
  if (!Array.isArray(sections)) throw new Error("sections must be an array");
  const chunks = [];
  for (const section of sections) {
    const paragraphs = String(section.text ?? "").split(/\n\s*\n/);
    let part = "";
    let index = 0;
    for (const paragraph of paragraphs) {
      const pieces = paragraph.length > maxChars ? paragraph.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g")) : [paragraph];
      for (const piece of pieces ?? []) {
        if (part && part.length + piece.length + 2 > maxChars) {
          chunks.push({ id: `${sourceUid}-${chunks.length + 1}`, sourceUid, contentHash, text: part, locator: { ...section.locator } });
          part = "";
        }
        part = part ? `${part}\n\n${piece}` : piece;
        index += 1;
      }
    }
    if (part.trim()) chunks.push({ id: `${sourceUid}-${chunks.length + 1}`, sourceUid, contentHash, text: part, locator: { ...section.locator } });
  }
  return chunks;
}
