import React from "react";
import { format } from "date-fns";
import { dateFromValue, formatDecimal } from "./reportEngine";
const safeFilePart = (value) =>
  String(value || "report")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "report";

const reportModeLabel = (mode) => (mode === "detail" ? "Detail" : "Summary");

const reportExportTitle = (reportData) =>
  [
    reportData?.title || "Report",
    reportData?.mode ? reportModeLabel(reportData.mode) : "",
  ].filter(Boolean).join(" - ");

const reportFileName = (reportData, extension) => {
  const fileParts = [
    safeFilePart(reportData?.title),
    reportData?.mode ? safeFilePart(reportModeLabel(reportData.mode)) : "",
    format(new Date(), "yyyy-MM-dd_HH-mm"),
  ].filter(Boolean);
  return `${fileParts.join("_")}.${extension}`;
};

const displayColumnValue = (column, row) => {
  const value = column.render ? column.render(row) : row[column.key];
  if (React.isValidElement(value)) return "";
  if (value === null || value === undefined) return "";
  return String(value);
};

const reportRowsForExport = (reportData) => {
  if (!reportData) return [];

  return (reportData.groups || []).flatMap((group) => {
    const dataRows = (group.rows || []).map((row) => {
      const exportRow = { Group: group.name };
      reportData.columns.forEach((column) => {
        exportRow[column.label] = displayColumnValue(column, row);
      });
      return exportRow;
    });

    if (!group.footerRow) return dataRows;

    const footerExportRow = { Group: `${group.name} Total` };
    reportData.columns.forEach((column) => {
      footerExportRow[column.label] = displayColumnValue(column, group.footerRow);
    });
    return [...dataRows, footerExportRow];
  });
};

const reportStatsForExport = (reportData) =>
  (reportData?.stats || []).map((stat) => ({
    Metric: stat.label,
    Value: stat.value,
    Subtitle: stat.subtitle || "",
  }));

const reportSummarySections = (reportData) =>
  Array.isArray(reportData?.summarySections) ? reportData.summarySections : [];

const reportSummaryRowsForExport = (section) =>
  (section.rows || []).map((row) => {
    const exportRow = {};
    (section.columns || []).forEach((column) => {
      exportRow[column.label] = displayColumnValue(column, row);
    });
    return exportRow;
  });

const reportSummarySheetRows = (reportData) => {
  const rows = [
    [reportExportTitle(reportData)],
    [reportData.description || ""],
    ...(reportData.warnings || []).map((warning) => ["Review", warning]),
    [],
    ["Metric", "Value", "Subtitle"],
    ...reportStatsForExport(reportData).map((stat) => [stat.Metric, stat.Value, stat.Subtitle]),
  ];

  reportSummarySections(reportData).forEach((section) => {
    rows.push([], [section.title || "Summary"]);
    rows.push((section.columns || []).map((column) => column.label));
    reportSummaryRowsForExport(section).forEach((row) => {
      rows.push((section.columns || []).map((column) => row[column.label] || ""));
    });
  });

  return rows;
};

const csvCell = (value) => {
  const raw = String(value ?? "");
  const text = /^[=+@-]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const printableAverageLineChartSvg = (item = {}, chartRange = {}) => {
  const points = Array.isArray(item.chartPoints) ? item.chartPoints : [];
  if (!points.length) return `<div class="empty-chart">No chart data</div>`;

  const width = 640;
  const height = 240;
  const margin = { top: 18, right: 18, bottom: 34, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point.average).filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax ? Math.max(Math.abs(rawMax) * 0.1, 1) : (rawMax - rawMin) * 0.12;
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  const yRange = yMax - yMin || 1;
  const start = dateFromValue(chartRange.start) || dateFromValue(points[0]?.date);
  const end = dateFromValue(chartRange.end) || dateFromValue(points[points.length - 1]?.date);
  const startTime = start?.getTime() || 0;
  const endTime = end?.getTime() || startTime;
  const timeRange = endTime - startTime;
  const lineColor = item.type === "Dosage" ? "#0f766e" : "#2563eb";
  const xForPoint = (point, index) => {
    if (timeRange <= 0) {
      return points.length === 1
        ? margin.left + plotWidth / 2
        : margin.left + (index / (points.length - 1)) * plotWidth;
    }

    const pointDate = dateFromValue(point.date);
    const ratio = pointDate ? (pointDate.getTime() - startTime) / timeRange : index / Math.max(points.length - 1, 1);
    return margin.left + Math.min(Math.max(ratio, 0), 1) * plotWidth;
  };
  const yForValue = (value) => margin.top + (1 - ((value - yMin) / yRange)) * plotHeight;
  const ticks = Array.from({ length: 4 }, (_, index) => yMin + (yRange / 3) * index).reverse();
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xForPoint(point, index)} ${yForValue(point.average)}`)
    .join(" ");
  const xLabels = [
    start ? format(start, "M/d") : points[0]?.dateLabel,
    end ? format(end, "M/d") : points[points.length - 1]?.dateLabel,
  ].filter(Boolean);

  const tickHtml = ticks.map((tick) => {
    const y = yForValue(tick);
    return `
      <g>
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${escapeHtml(formatDecimal(tick))}</text>
      </g>
    `;
  }).join("");
  const pointHtml = points.map((point, index) => {
    const x = xForPoint(point, index);
    const y = yForValue(point.average);
    return `<circle cx="${x}" cy="${y}" r="4.5" fill="#ffffff" stroke="${lineColor}" stroke-width="2.5" />`;
  }).join("");
  const labelHtml = xLabels.map((label, index) => `
    <text
      x="${index === 0 ? margin.left : width - margin.right}"
      y="${height - 10}"
      text-anchor="${index === 0 ? "start" : "end"}"
      font-size="11"
      fill="#64748b"
    >${escapeHtml(label)}</text>
  `).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="print-chart-svg" role="img" aria-label="${escapeHtml(item.name || "Average chart")}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#f8fafc" />
      ${tickHtml}
      <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#cbd5e1" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" stroke="#cbd5e1" />
      ${points.length > 1 ? `<path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${pointHtml}
      ${labelHtml}
    </svg>
  `;
};

const printableReportHtml = (reportData) => {
  const exportTitle = reportExportTitle(reportData);
  const statsHtml = reportStatsForExport(reportData)
    .map((stat) => `
      <div class="stat">
        <span>${escapeHtml(stat.Metric)}</span>
        <strong>${escapeHtml(stat.Value)}</strong>
        ${stat.Subtitle ? `<small>${escapeHtml(stat.Subtitle)}</small>` : ""}
      </div>
    `)
    .join("");

  const summarySectionsHtml = reportSummarySections(reportData)
    .map((section) => `
      <section class="summary-section">
        <h2>${escapeHtml(section.title || "Summary")}</h2>
        <table>
          <thead>
            <tr>${(section.columns || []).map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${(section.rows || []).map((row) => `
              <tr>
                ${(section.columns || []).map((column) => `<td>${escapeHtml(displayColumnValue(column, row))}</td>`).join("")}
              </tr>
            `).join("") || `<tr><td colspan="${section.columns?.length || 1}">No summary rows.</td></tr>`}
          </tbody>
        </table>
      </section>
    `)
    .join("");

  const chartSectionsHtml = (reportData.chartSections || [])
    .map((section) => {
      const items = (section.items || []).filter((item) => item.chartPoints?.length);
      if (!items.length) return "";

      return `
        <section class="chart-section">
          <h2>${escapeHtml(section.title || "Charts")}</h2>
          <div class="chart-grid">
            ${items.map((item) => `
              <article class="chart-card">
                <h3>${escapeHtml(item.name || "Chart")}</h3>
                <p>Avg ${escapeHtml(formatDecimal(item.average))}${item.unit ? ` ${escapeHtml(item.unit)}` : ""} | Low ${escapeHtml(formatDecimal(item.low))} | High ${escapeHtml(formatDecimal(item.high))}</p>
                ${printableAverageLineChartSvg(item, reportData.chartRange || {})}
              </article>
            `).join("")}
          </div>
        </section>
      `;
    })
    .join("");

  const groupsHtml = (reportData.groups || [])
    .map((group) => {
      const tableRows = (group.rows || []).map((row) => `
        <tr>
          ${reportData.columns.map((column) => `<td>${escapeHtml(displayColumnValue(column, row))}</td>`).join("")}
        </tr>
      `).join("");
      const footerRow = group.footerRow ? `
        <tr class="footer">
          ${reportData.columns.map((column) => `<td>${escapeHtml(displayColumnValue(column, group.footerRow))}</td>`).join("")}
        </tr>
      ` : "";

      return `
        <section>
          <h2>${escapeHtml(group.name)}</h2>
          <table>
            <thead>
              <tr>${reportData.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="${reportData.columns.length}">No rows in this group.</td></tr>`}
              ${footerRow}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(exportTitle)}</title>
        <style>
          body { color: #0f172a; font-family: Arial, sans-serif; margin: 28px; }
          h1 { font-size: 24px; margin: 0 0 4px; }
          .generated { color: #64748b; font-size: 12px; margin-bottom: 18px; }
          .stats { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); margin-bottom: 18px; }
          .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
          .stat span { color: #64748b; display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .stat strong { display: block; font-size: 18px; margin-top: 4px; }
          .stat small { color: #64748b; display: block; margin-top: 2px; }
          .summary-section { margin-bottom: 20px; }
          .chart-section { margin-bottom: 20px; }
          .chart-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .chart-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; break-inside: avoid; }
          .chart-card h3 { font-size: 13px; margin: 0; }
          .chart-card p { color: #64748b; font-size: 10px; margin: 3px 0 8px; }
          .print-chart-svg { display: block; width: 100%; }
          .empty-chart { border: 1px dashed #cbd5e1; border-radius: 6px; color: #64748b; font-size: 11px; padding: 24px; text-align: center; }
          section { break-inside: avoid; margin-top: 18px; }
          h2 { font-size: 16px; margin-bottom: 8px; }
          table { border-collapse: collapse; font-size: 11px; width: 100%; }
          th { background: #f1f5f9; color: #475569; font-size: 10px; text-align: left; text-transform: uppercase; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; }
          .footer td { background: #f8fafc; font-weight: 700; }
          @media print { body { margin: 18px; } .stats { grid-template-columns: repeat(2, 1fr); } .chart-grid { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(exportTitle)}</h1>
        <p>${escapeHtml(reportData.description || "")}</p>
        ${(reportData.warnings || []).map((warning) => `<p><strong>Review:</strong> ${escapeHtml(warning)}</p>`).join("")}
        <div class="generated">Generated ${escapeHtml(format(new Date(), "MM/dd/yyyy h:mm a"))}</div>
        <div class="stats">${statsHtml}</div>
        ${summarySectionsHtml}
        ${chartSectionsHtml}
        ${groupsHtml}
      </body>
    </html>
  `;
};


export { safeFilePart, reportModeLabel, reportExportTitle, reportFileName, displayColumnValue, reportRowsForExport, reportStatsForExport, reportSummarySections, reportSummaryRowsForExport, reportSummarySheetRows, csvCell, escapeHtml, printableAverageLineChartSvg, printableReportHtml };
