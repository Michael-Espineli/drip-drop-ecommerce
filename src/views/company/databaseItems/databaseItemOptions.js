export const UOM_OPTIONS = [
  { id: 1, label: "Gallon" },
  { id: 2, label: "Pounds" },
  { id: 3, label: "Ounce" },
  { id: 4, label: "Feet" },
  { id: 5, label: "Square Feet" },
  { id: 6, label: "Liter" },
  { id: 7, label: "Inch" },
  { id: 8, label: "Quart" },
  { id: 9, label: "Tab" },
  { id: 10, label: "Unit" },
];

export const CATEGORY_OPTIONS = [
  { id: 1, label: "PVC" },
  { id: 2, label: "Galvanized" },
  { id: 3, label: "Chemicals" },
  { id: 4, label: "Useables" },
  { id: 5, label: "Equipment" },
  { id: 6, label: "Parts" },
  { id: 7, label: "Electrical" },
  { id: 8, label: "Tools" },
  { id: 9, label: "Misc" },
];

export const SUBCATEGORY_OPTIONS = [
  "Pipe",
  "Glue",
  "Primer",
  "Pipe Extender",
  "Fitting Extender",
  "Inside Coupler",
  "Sweep",
  "Street",
  "Valve",
  "Bushing",
  "Tee",
  "Elbow",
  "45",
  "Coupler",
  "Union",
  "Male Adaptor",
  "Nipple",
  "Pump",
  "Heater",
  "Filter",
  "Salt Cell",
  "Light",
  "Cleaner",
  "Control System",
  "Auto Chlorinator",
  "Wire",
  "Misc",
].map((label, index) => ({ id: index + 1, label }));

export const DEFAULT_UOM = UOM_OPTIONS.find((option) => option.label === "Unit");
export const DEFAULT_CATEGORY = CATEGORY_OPTIONS.find((option) => option.label === "Misc");
export const DEFAULT_SUBCATEGORY = SUBCATEGORY_OPTIONS.find((option) => option.label === "Misc");

export const isChemicalCategory = (category) => {
  const label = typeof category === "string" ? category : category?.label;
  return ["chemical", "chemicals"].includes(String(label || "").trim().toLowerCase());
};

export const findOptionByLabel = (options, label, fallback) =>
  options.find((option) => option.label === label) || fallback;

export const databaseItemSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "48px",
    borderRadius: "12px",
    borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
    boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
    "&:hover": { borderColor: "#CBD5E1" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 12px" }),
  menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
    color: "#0F172A",
  }),
};

export const databaseItemSelectTheme = (theme) => ({
  ...theme,
  borderRadius: 12,
  colors: {
    ...theme.colors,
    primary25: "rgba(59,130,246,0.10)",
    primary: "#2563EB",
    neutral0: "#FFFFFF",
    neutral80: "#0F172A",
    neutral20: "#E2E8F0",
    neutral30: "#CBD5E1",
  },
});
