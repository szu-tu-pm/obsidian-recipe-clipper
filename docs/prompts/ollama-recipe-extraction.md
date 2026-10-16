# Ollama recipe extraction

Local Tier 3 fallback for the URL clipper. The plugin calls `POST {endpoint}/api/chat` on a loopback Ollama server only (`http://127.0.0.1`, `http://localhost`, or `http://[::1]`). There is no cloud-model fallback.

Defaults:

- Model: `qwen2.5:7b-instruct`
- Lightweight preset: `llama3.2:3b-instruct` or `qwen2.5:3b-instruct`
- Health check: `GET /api/tags`, 1,500 ms
- Chat timeout: 25,000 ms, abortable
- `temperature`: 0
- `format`: the JSON schema below (`additionalProperties: false`)

The model response is validated with Zod and then grounded: every ingredient line, instruction, title, author, site name, serving phrase, cooking method, and duration must appear in the page text. Anything else is dropped. Ingredient lines that remain are passed unchanged to the Stage 1 lexical parser.

## System prompt

```
You extract one recipe from untrusted webpage text. Return JSON only.
Rules:
- Copy ingredient lines and instruction steps verbatim from the page text.
- Do not invent ingredients, quantities, units, steps, times, authors, titles, or cooking methods.
- Do not summarize, translate, or convert units.
- Keep unicode fractions and ranges as they appear.
- If a field is missing on the page, use null or an empty array.
- ingredientsRaw is one original ingredient line per entry, with no added words.
- instructions is one original step per entry, with no added words.
- prepTimeMinutes, cookTimeMinutes, and totalTimeMinutes are integers only when the page states that duration. Otherwise null.
- A stated "1 hour 30 minutes" may be returned as 90. Do not guess a duration that is not stated.
```

## JSON schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "ingredientsRaw", "instructions"],
  "properties": {
    "title": { "type": "string" },
    "ingredientsRaw": { "type": "array", "items": { "type": "string" } },
    "instructions": { "type": "array", "items": { "type": "string" } },
    "author": { "type": ["string", "null"] },
    "siteName": { "type": ["string", "null"] },
    "servingsRaw": { "type": ["string", "null"] },
    "prepTimeMinutes": { "type": ["integer", "null"] },
    "cookTimeMinutes": { "type": ["integer", "null"] },
    "totalTimeMinutes": { "type": ["integer", "null"] },
    "cookingMethods": { "type": "array", "items": { "type": "string" } }
  }
}
```
