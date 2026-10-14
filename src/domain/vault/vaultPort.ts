export interface YamlCodec {
	parse(yaml: string): unknown;
	stringify(value: Record<string, unknown>): string;
}

export interface VaultPort {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	remove(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(folder: string): Promise<string[]>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export interface CachedFrontmatter {
	path: string;
	frontmatter: Record<string, unknown> | null;
}

export interface FrontmatterCachePort {
	listMarkdown(folder: string): CachedFrontmatter[];
	readFrontmatter(path: string): Record<string, unknown> | null;
}

export interface ImageProcessor {
	downscaleToWebp(
		data: ArrayBuffer,
		mime: string,
		maxPx: number,
		quality: number,
	): Promise<ArrayBuffer | null>;
}
