export declare function stringify(
	data: unknown,
	replacer?: (key: string, value: unknown) => unknown,
	options?:
		| string
		| number
		| { indent?: string | number; chunkSize?: number; itemPerLine?: boolean; ndjson?: boolean },
): AsyncIterable<Uint8Array>

export declare function asAsyncBuffer(stream: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>

export declare function asAsyncObject(
	stream: AsyncIterable<[string | Symbol, unknown]>,
): AsyncIterable<[string | Symbol, unknown]>
