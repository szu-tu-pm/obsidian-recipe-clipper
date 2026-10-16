export function cleanText(value: string): string {
	return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanIngredient(value: string): string {
	return cleanText(value).replace(/^[-*•]\s+/, "");
}

export function cleanInstruction(value: string): string {
	return cleanText(value).replace(/^\d+[.)]\s+/, "");
}

export function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}

export function sourceIncludes(haystack: string, needle: string): boolean {
	const normalized = cleanText(needle).toLowerCase();
	if (normalized.length < 2) {
		return false;
	}
	return cleanText(haystack).toLowerCase().includes(normalized);
}

export function absoluteHttpUrl(value: string, base: string): string | null {
	try {
		const url = new URL(value, base);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

export function parseServings(
	raw: string | number | null | undefined,
): { raw: string; amount: number | null } | null {
	if (raw == null) {
		return null;
	}
	const text = cleanText(String(raw));
	if (!text) {
		return null;
	}
	if (/\d\s*(?:[-–—]|to)\s*\d/i.test(text)) {
		return { raw: text, amount: null };
	}
	const match = text.match(/\d+(?:\.\d+)?/);
	if (!match) {
		return { raw: text, amount: null };
	}
	const amount = Number(match[0]);
	if (!Number.isFinite(amount) || amount <= 0) {
		return { raw: text, amount: null };
	}
	return { raw: text, amount };
}

const MAX_DURATION_MINUTES = 7 * 24 * 60;

export function parseDurationMinutes(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return clampDuration(Math.round(value));
	}
	if (typeof value !== "string") {
		return null;
	}
	const text = value.trim();
	if (!text) {
		return null;
	}
	const iso = text.match(
		/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
	);
	if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
		const days = Number(iso[1] ?? 0);
		const hours = Number(iso[2] ?? 0);
		const minutes = Number(iso[3] ?? 0);
		const seconds = Number(iso[4] ?? 0);
		if (days === 0 && hours === 0 && minutes === 0) {
			return null;
		}
		return clampDuration(days * 24 * 60 + hours * 60 + minutes + (seconds >= 30 ? 1 : 0));
	}

	let total = 0;
	let matched = false;
	const hour = text.match(/(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr)\b/i);
	const minute = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min)\b/i);
	if (hour) {
		total += Math.round(Number(hour[1]) * 60);
		matched = true;
	}
	if (minute) {
		total += Math.round(Number(minute[1]));
		matched = true;
	}
	return matched ? clampDuration(total) : null;
}

function clampDuration(minutes: number): number | null {
	if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_DURATION_MINUTES) {
		return null;
	}
	return minutes;
}

/** Accept a model-supplied minute count only when the page states that duration. */
export function durationIsGrounded(minutes: number, source: string): boolean {
	if (
		new RegExp(`\\b${minutes}\\s*(?:minutes|minute|mins|min)\\b`, "i").test(source)
	) {
		return true;
	}
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	if (hours <= 0) {
		return false;
	}
	const hourPattern = new RegExp(`\\b${hours}\\s*(?:hours|hour|hrs|hr)\\b`, "i");
	if (remainder === 0) {
		return hourPattern.test(source);
	}
	const minutePattern = new RegExp(
		`\\b${remainder}\\s*(?:minutes|minute|mins|min)\\b`,
		"i",
	);
	return hourPattern.test(source) && minutePattern.test(source);
}

export function normalizeRecipeSourceUrl(value: string): string | null {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		url.hash = "";
		url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
		const keys = [...url.searchParams.keys()];
		for (const key of keys) {
			const lower = key.toLowerCase();
			if (
				lower.startsWith("utm_") ||
				lower === "fbclid" ||
				lower === "gclid" ||
				lower === "mc_cid" ||
				lower === "mc_eid"
			) {
				url.searchParams.delete(key);
			}
		}
		url.searchParams.sort();
		url.pathname = url.pathname.replace(/\/+$/, "") || "/";
		return url.toString();
	} catch {
		return null;
	}
}
