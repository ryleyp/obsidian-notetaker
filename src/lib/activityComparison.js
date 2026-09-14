import { IMPROVEMENT_FIELDS } from "./activityImprovement";

const clean = (value) => String(value || "").trim().toLowerCase();
const sourceKey = (row) => `${row.eventDate || ""}|${clean(row.sourceTitle)}`;
const titleKey = (row) => `${row.eventDate || ""}|${clean(row.title)}`;

export function compareActivityRows(current, alternative) {
  const used = new Set();
  const items = current.map((row, currentIndex) => {
    let alternativeIndex = alternative.findIndex((candidate, index) => !used.has(index) && clean(candidate.sourceTitle) && sourceKey(candidate) === sourceKey(row));
    if (alternativeIndex < 0) alternativeIndex = alternative.findIndex((candidate, index) => !used.has(index) && titleKey(candidate) === titleKey(row));
    if (alternativeIndex < 0 && alternative[currentIndex] && !used.has(currentIndex)) alternativeIndex = currentIndex;
    if (alternativeIndex >= 0) used.add(alternativeIndex);
    const other = alternativeIndex >= 0 ? alternative[alternativeIndex] : null;
    return {
      currentIndex,
      alternativeIndex,
      current: row,
      alternative: other,
      changedFields: other ? IMPROVEMENT_FIELDS.filter((field) => row[field] !== other[field]) : [],
    };
  });
  alternative.forEach((row, alternativeIndex) => {
    if (!used.has(alternativeIndex)) items.push({ currentIndex: -1, alternativeIndex, current: null, alternative: row, changedFields: IMPROVEMENT_FIELDS });
  });
  return items;
}

export function acceptActivityAlternative(current, alternative, item, field = null) {
  if (!item?.alternative) return current;
  if (item.currentIndex < 0) return [...current, { ...item.alternative }];
  return current.map((row, index) => {
    if (index !== item.currentIndex) return row;
    if (field) return { ...row, [field]: item.alternative[field], verify: "", verifyReason: "", verifySource: "", verifyEvidence: "" };
    return {
      ...row,
      ...Object.fromEntries(IMPROVEMENT_FIELDS.map((key) => [key, item.alternative[key]])),
      verify: "", verifyReason: "", verifySource: "", verifyEvidence: "",
    };
  });
}
