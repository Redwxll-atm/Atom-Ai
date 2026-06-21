import { createRequire } from "module";
const _require = createRequire(import.meta.url);

export const VERSION = _require("../package.json").version;

export const state = {
  MODEL: "z-ai/glm-5-turbo",
  MODEL_LABEL: "glm-5-turbo",
  conversationHistory: [],
  promptCount: 0,
  filesCreated: 0,
  filesEdited: 0,
  sessionStart: Date.now(),
  config: {},
};

export const MODELS = [
  { id: "z-ai/glm-5-turbo", label: "glm-5-turbo" },
  { id: "z-ai/glm-5.2", label: "glm-5.2" },
  { id: "openai/gpt-4o", label: "gpt-4o" },
  { id: "openai/gpt-4-turbo", label: "gpt-4-turbo" },
  { id: "meta-llama/llama-3-70b-instruct", label: "llama-3-70b" },
  { id: "mistral-large", label: "mistral-large" }
];

export const systemPrompt = `You are an autonomous AI coding agent. You have FULL VISIBILITY of the user's project files (provided below as context).
Analyze the existing code structure before deciding what to do. Be smart: if a file exists, EDIT it. If it doesn't, create it with FILE.

You MUST respond EXCLUSIVELY with a valid JSON object. Do NOT wrap the JSON in any other text, just output the JSON object.
Use the following strict schema. CRITICAL: Ensure all strings inside the JSON are properly escaped (use \\n for newlines, and escape double quotes \\").

{
  "message": "A concise explanation of what you are doing (optional)",
  "filesToCreate": [
    {
      "path": "path/to/new_file.ext",
      "content": "Full content of the new file"
    }
  ],
  "filesToEdit": [
    {
      "path": "path/to/existing_file.ext",
      "search": "exact lines to find in the file",
      "replace": "new lines to put in their place"
    }
  ],
  "filesToDelete": [
    "path/to/file_or_folder"
  ],
  "commandsToRun": [
    "npm test",
    "node script.js"
  ]
}

- Keep "message" concise and normal.
- If you don't need to do an action, leave the array empty \`[]\` or omit it.
- Write compact and efficient code.
- If no file operations are needed, just provide a "message" and leave the arrays empty.`;
