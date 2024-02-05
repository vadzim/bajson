// TODO: is it possible to integrate with io-ts to emit typed values?

export type ParsedJSON = ParsedNull | ParsedBoolean | ParsedNumber | ParsedString | ParseMap | ParsedArray

type ParsedNull = {
	type: "null"
	read: () => Promise<null>
}

type ParsedBoolean = {
	type: "boolean"
	read: () => Promise<boolean>
}

type ParsedNumber = {
	type: "number"
	read: () => Promise<number>
}

type ParsedString = {
	type: "string"
	read: () => Promise<string>
	stream: () => AsyncIterable<Uint8Array>
}

type ParseMap<T = unknown, P = ParsedJSON> = {
	type: "map"
	read: () => Promise<Record<string, T>>
	entries: () => AsyncIterable<[key: string, value: P]>
	keys: () => AsyncIterable<string>
	values: () => AsyncIterable<P>
}

type ParsedArray<T = unknown, P = ParsedJSON> = {
	type: "array"
	read: () => Promise<T[]>
	entries: () => AsyncIterable<[key: number, value: P]>
	keys: () => AsyncIterable<number>
	values: () => AsyncIterable<P>
}

export declare function parse(data: AsyncIterable<Uint8Array>): Promise<ParsedJSON>
