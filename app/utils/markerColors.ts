export const MARKER_COLORS: Record<string, { background: string; border: string }> = {
  restaurant: { background: "#FF6B6B", border: "#D64545" },
  airport:    { background: "#4ECDC4", border: "#399E97" },
  attraction: { background: "#FFD93D", border: "#C9A71A" },
  accessible: { background: "#F59E0B", border: "#D97706" },
  default:    { background: "#4D96FF", border: "#2E76E6" },
};

export function getMarkerColor(type: string) {
  return MARKER_COLORS[type] ?? MARKER_COLORS.default;
}
