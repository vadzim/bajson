export type ParsedJSON<Key extends string | number | undefined = string | number | undefined> = {
	key: Key
} & (
	| {
			type: "null"
			value: Promise<null>
	  }
	| {
			type: "number"
			value: Promise<number>
	  }
	| {
			type: "boolean"
			value: Promise<boolean>
	  }
	| {
			type: "string"
			value: Promise<string> & AsyncIterable<Uint8Array>
	  }
	| {
			type: "object"
			value: Promise<Record<string, unknown>> & AsyncIterable<ParsedJSON<string>>
	  }
	| {
			type: "array"
			value: Promise<unknown[]> & AsyncIterable<ParsedJSON<number>>
	  }
)

export declare function parse(data: AsyncIterable<Uint8Array>): Promise<ParsedJSON<undefined>>
