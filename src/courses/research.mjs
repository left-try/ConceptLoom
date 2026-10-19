import { readJson, updateCourse, courseError } from "./state.mjs";

const catalogPath = ".concept-loom/sources/catalog.json";
export async function recordCourseResearch(root, { courseUid, expectedRevision, sourceUids = [], receipts = [] } = {}) {
  if (!Array.isArray(sourceUids) || !Array.isArray(receipts) || new Set(sourceUids).size !== sourceUids.length) throw courseError("INVALID_RESEARCH", "sourceUids and receipts must be unique arrays");
  const catalog = await readJson(root, catalogPath, { optional: true }) ?? { sources: {} };
  const validated = [];
  for (const sourceUid of sourceUids) {
    const source = catalog.sources?.[sourceUid];
    const item = receipts.find(receipt => receipt.sourceUid === sourceUid);
    if (!source || !item) throw courseError("SOURCE_NOT_FOUND", `research source ${sourceUid} is missing`);
    if (item.canonicalResource !== source.canonicalResource || item.contentHash !== source.currentContentHash || item.coverage !== source.coverage || item.receipt?.openedResource !== source.receipt?.openedResource) throw courseError("RESEARCH_RECEIPT_MISMATCH", `receipt for ${sourceUid} does not match the imported manifest`);
    validated.push({ sourceUid, canonicalResource: source.canonicalResource, contentHash: source.currentContentHash ?? null, title: source.title, coverage: source.coverage, receipt: structuredClone(item.receipt) });
  }
  return updateCourse(root, courseUid, expectedRevision, course => {
    course.sourceUids = [...new Set([...course.sourceUids, ...sourceUids])];
    course.sourceReceipts = [...(course.sourceReceipts ?? []), ...validated];
    course.status = "researching";
    course.updatedAt = new Date().toISOString();
    return course;
  });
}
