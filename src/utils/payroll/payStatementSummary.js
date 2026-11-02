const completedDate = (value) => {
  if (value === undefined || value === null || value === "") return null;
  let date;
  if (typeof value.toDate === "function") date = value.toDate();
  else if (typeof value === "object" && (value.seconds ?? value._seconds) !== undefined) {
    date = new Date((value.seconds ?? value._seconds) * 1000);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const groupStatementLinesByDay = (lines = []) => {
  const days = new Map();
  lines.forEach((line) => {
    const date = completedDate(line.completedDate);
    const key = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : "undated";
    const day = days.get(key) || {
      key,
      label: date ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Date unavailable",
      totalCents: 0,
      lineCount: 0,
    };
    day.totalCents += Number(line.totalAmountCents || 0);
    day.lineCount += 1;
    days.set(key, day);
  });
  return [...days.values()].sort((left, right) => left.key.localeCompare(right.key));
};
