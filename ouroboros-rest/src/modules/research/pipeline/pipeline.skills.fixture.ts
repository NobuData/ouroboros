/** The input fields each shipped procedure must name — what the pipeline actually sends (#624). */
export const OUTPUT_KEYWORDS = {
  "create-roadmap": ["brief", "outline", "previous", "suggestions", "today"],
  "create-issues": ["roadmap", "items", "brief"],
} as const;
