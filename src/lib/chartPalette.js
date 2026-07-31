// Product chrome stays black and white. Data visualizations use these
// accessible colors so separate series remain easy to distinguish.
export const chartPalette = Object.freeze({
  blue: '#2563eb',
  green: '#16a34a',
  amber: '#d97706',
  violet: '#7c3aed',
  cyan: '#0891b2',
  red: '#dc2626',
});

export const chartSeriesColors = Object.freeze([
  chartPalette.blue,
  chartPalette.green,
  chartPalette.amber,
  chartPalette.violet,
  chartPalette.cyan,
  chartPalette.red,
]);
