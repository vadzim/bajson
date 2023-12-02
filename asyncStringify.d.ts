export declare function stringify(
	data: unknown,
	replacer?: (key: string, value: unknown) => unknown,
	indent?: string | number,
	options?: { chunkSize?: number },
): AsyncIterable<Uint8Array, void, void>

export declare function asAsyncBuffer(
	stream: AsyncIterable<Uint8Array, unknown, unknown>,
): AsyncIterable<Uint8Array, void, void>

export declare function asAsyncObject(
	stream: AsyncIterable<[string | Symbol, unknown], unknown, unknown>,
): AsyncIterable<[string | Symbol, unknown], void, void>
