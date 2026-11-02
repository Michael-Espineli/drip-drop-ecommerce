export const statementPreviewSummaryState = (lines) => {
  const linkedId = value => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1500 && ![".", ".."].includes(value) && !value.includes("/");
  return {
    technicianIds: [...new Set(lines.map(line => line.technicianId).filter(linkedId))],
    serviceStopIds: [...new Set(lines.map(line => line.serviceStopId).filter(linkedId))],
    totalAmountCents: lines.reduce((sum, line) => sum + Number(line.totalAmountCents), 0),
  };
};

export const statementPreviewSummary = (lines) => {
  const state = statementPreviewSummaryState(lines);
  return { technicianCount: state.technicianIds.length, totalAmountCents: state.totalAmountCents, stopCount: state.serviceStopIds.length };
};

export const buildStatementCandidateGroups = (lines, limit = 400) => {
  const technicians = new Map();
  lines.forEach(line => {
    const group = technicians.get(line.technicianId) || [];
    group.push(line);
    technicians.set(line.technicianId, group);
  });
  return [...technicians.entries()].flatMap(([technicianId, items]) => {
    const sorted = [...items].sort((a, b) => Number(a.completedDate) - Number(b.completedDate) || a.id.localeCompare(b.id));
    const partCount = Math.ceil(sorted.length / limit);
    return Array.from({ length: partCount }, (_, index) => {
      const lineItems = sorted.slice(index * limit, (index + 1) * limit);
      return { key: `${technicianId}:${index}`, technicianId,
        technicianName: items.find(line => line.technicianName)?.technicianName || technicianId,
        workerType: items.find(line => line.workerType)?.workerType || "notAssigned", lineItems,
        subtotalCents: lineItems.reduce((sum, line) => sum + Number(line.totalAmountCents), 0), part: index + 1, partCount };
    });
  }).sort((a, b) => a.technicianName.localeCompare(b.technicianName) || a.part - b.part);
};
