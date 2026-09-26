/**
 * What the Settings page lets the owner edit. Everything else in `.env` stays
 * as the installer wrote it. Labels are English: they name services.
 */
export type SettingField = {
  key: string;
  label: string;
  help: string;
  url?: string;
  kind: "secret" | "text" | "select";
  options?: Array<{ value: string; label: string }>;
  required: boolean;
  /** Which test the "Test" button runs, if any. */
  test?: "gemini" | "youtube" | "cli";
};

export const SETTING_FIELDS: SettingField[] = [
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API key",
    help: "YouTube summaries, research and (by default) scripts. Create a key in Google AI Studio on the project that holds your credits; turn billing on for Search grounding.",
    url: "https://aistudio.google.com/apikey",
    kind: "secret",
    required: true,
    test: "gemini",
  },
  {
    key: "YOUTUBE_API_KEY",
    label: "YouTube Data API key",
    help: "Channel lists, view counts and comments. Free: Google Cloud console → enable “YouTube Data API v3” → Credentials → Create API key.",
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    kind: "secret",
    required: true,
    test: "youtube",
  },
  {
    key: "AI_PROVIDER",
    label: "Who writes titles, scripts and reports",
    help: "Claude or Codex use your subscription through the CLI installed on this PC (see docs/SUBSCRIPTION-MODE.md). YouTube summaries always use Gemini.",
    kind: "select",
    options: [
      { value: "gemini", label: "Gemini API (credits)" },
      { value: "claude", label: "Claude Code CLI (Claude subscription)" },
      { value: "codex", label: "Codex CLI (ChatGPT subscription)" },
    ],
    required: false,
    test: "cli",
  },
  {
    key: "CLAUDE_CLI_MODEL",
    label: "Claude model (optional)",
    help: "e.g. opus or sonnet. Empty uses the CLI's default.",
    kind: "text",
    required: false,
  },
  {
    key: "CODEX_CLI_MODEL",
    label: "Codex model (optional)",
    help: "Empty uses the CLI's default.",
    kind: "text",
    required: false,
  },
  {
    key: "MONTHLY_SPEND_CAP_USD",
    label: "Monthly Gemini spend cap (USD)",
    help: "The app refuses paid Gemini calls above this. Subscription-mode calls count as $0.",
    kind: "text",
    required: false,
  },
];

export const EDITABLE_KEYS = new Set(SETTING_FIELDS.map((f) => f.key));
