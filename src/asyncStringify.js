/**
 * @param {unknown} [data]
 * @param {undefined | Array<string | number> | ((key: string, value: unknown) => unknown)} [replacer=undefined]
 * @param {number | string | {
 * 		indent: number | string
 * 		chunkSize: number
 * 		ndjson: boolean
 * 		itemPerLine: boolean
 * 	}} [options=undefined]
 * @return {AsyncIterable<Uint8Array>}
 */
export async function* stringify(data, replacer, options) {
	const {
		chunkSize = 10_000,
		ndjson = false,
		itemPerLine = false,
		indent = undefined,
	} = typeof options === "object" ? options ?? {} : { indent: options }

	const parsedIndent = parseIndent(indent)

	if ([parsedIndent !== undefined, itemPerLine, ndjson].filter(Boolean).length > 1) {
		throw new Error("Only one of indent, ndjson or itemPerLine can be specified")
	}

	//
	//
	const ENTRIES = 0
	const ASYNC_ENTRIES = 1
	const ARRAY = 2
	const ITERATOR = 3
	const ASYNC_ITERATOR = 4
	const ASYNC = 5

	/**
	 * @typedef {
	 * 	| {
	 * 		type: ENTRIES
	 * 		items: Array<[string | Symbol, unknown]>
	 * 		currentIndex: number
	 * 		object: unknown
	 * 		dataPushed: boolean
	 * }
	 * 	| {
	 * 		type: ASYNC_ENTRIES
	 * 		items: AsyncIterator<[string | Symbol, unknown]>
	 * 		currentIndex: number
	 * 		object: unknown
	 * 		dataPushed: boolean
	 * }
	 * 	| {
	 * 		type: ARRAY
	 * 		items: Array<unknown>
	 * 		currentIndex: number
	 * 		object: unknown
	 * 		dataPushed: boolean
	 * }
	 * 	| {
	 * 		type: ITERATOR
	 * 		items: Iterator<unknown>
	 * 		currentIndex: number
	 * 		object: unknown
	 * 		dataPushed: boolean
	 * }
	 * 	| {
	 * 		type: ASYNC_ITERATOR
	 * 		items: AsyncIterator<unknown>
	 * 		currentIndex: number
	 * 		object: unknown
	 * 		dataPushed: boolean
	 * }
	 * }  StackItem
	 */

	const encoder = new TextEncoder()
	/**@type StackItem | null*/
	let head = null
	let buffer = ""
	let bufferYielded = false
	let key = ""
	/**@type TextDecoder*/
	let decoder
	/**@type null | Promise<void>*/
	let continuation = null
	/**@type Array<StackItem>*/
	const stack = []
	/**@type Promise<unknown> | undefined*/
	let pause = undefined
	/**@type Array<string>*/
	const indentCache = []

	const replacerFunction = typeof replacer === "function" ? replacer : undefined
	const propsFilter = Array.isArray(replacer)
		? new Set(replacer.filter(key => typeof key === "string" || typeof key === "number").map(String))
		: undefined

	/**@returns {string}*/
	const getIndent = (/**@type number*/ indentIndex) =>
		indentIndex < 0 ? "\n" : (indentCache[indentIndex] ??= getIndent(indentIndex - 1) + parsedIndent)

	const hasBuffer = () => {
		return buffer.length >= chunkSize
	}

	const pushChunk = (/**@type string*/ chunk) => {
		buffer += chunk
	}

	const getBuffer = () => {
		const result = encoder.encode(buffer)
		buffer = ""
		bufferYielded = true

		// create pause inside getBuffer and wait after yielding getBuffer result
		// to wait for pause while yielding ;)
		pause = getPause()

		return result
	}

	/**@return {StackItem}*/
	const newHead = (
		/**@type unknown**/ object,
		/**@type StackItem["type"]*/ type,
		/**@type StackItem["items"]*/ items,
	) => {
		if (head) stack.push(head)
		head = {
			type,
			items,
			object,
			currentIndex: 0,
			dataPushed: false,
		}
	}

	const startArray = () => {
		if (ndjson && stack.length === 0) {
			return
		}
		return pushChunk("[")
	}

	const closeArray = () => {
		if (!(ndjson && stack.length === 0)) {
			if (head.dataPushed) {
				if (parsedIndent !== undefined) {
					pushChunk(getIndent(stack.length - 1))
				}
				if (itemPerLine && stack.length === 0) {
					pushChunk("\n")
				}
			}
			pushChunk("]")
		}
		head = stack.pop()
	}

	const startObject = () => {
		return pushChunk("{")
	}

	const closeObject = () => {
		if (head.dataPushed) {
			if (parsedIndent !== undefined) {
				pushChunk(getIndent(stack.length - 1))
			}
			if (itemPerLine && stack.length === 0) {
				pushChunk("\n")
			}
		}
		pushChunk("}")
		head = stack.pop()
	}

	const startValue = () => {
		if (!head) {
			return
		}

		if (head.dataPushed) {
			if (stack.length === 0) {
				if (ndjson && (head.type === ARRAY || head.type === ITERATOR || head.type === ASYNC_ITERATOR)) {
					pushChunk("\n")
					return
				}
				if (itemPerLine) {
					pushChunk("\n")
				}
			}
			pushChunk(",")
		}
		head.dataPushed = true

		if (parsedIndent !== undefined) {
			pushChunk(getIndent(stack.length))
		}

		if (head.type === ENTRIES || head.type === ASYNC_ENTRIES) {
			pushChunk(JSON.stringify(key))
			pushChunk(":")
			if (parsedIndent !== undefined) {
				pushChunk(" ")
			}
		}
	}

	const processValue = (/**@type unknown*/ value) => {
		switch (typeof value) {
			case "number":
			case "boolean":
			case "string":
				break
			default: {
				const toJSON = /**@type undefined | { toJSON?: (key: string) => unknown }*/ (value)?.toJSON
				if (typeof toJSON === "function") {
					key = String(key ?? "")
					value = toJSON.call(value, key)
				}
			}
		}
		if (replacerFunction) {
			key = String(key ?? "")
			value = replacerFunction.call(head?.object ?? { [key]: value }, key, value)
		}
		switch (typeof value) {
			case "number": {
				startValue()
				const json = Number.isFinite(value) ? String(value) : "null"
				pushChunk(json)
				break
			}
			case "boolean": {
				startValue()
				const json = value ? "true" : "false"
				pushChunk(json)
				break
			}
			case "bigint": {
				// we already called toJSON so we can throw now
				throw new TypeError("Do not know how to serialize a BigInt")
			}
			case "string": {
				startValue()
				const json = JSON.stringify(value)
				pushChunk(json)
				break
			}
			case "object": {
				if (value === null) {
					startValue()
					pushChunk("null")
					break
				}
				if (Array.isArray(value)) {
					startValue()
					newHead(value, ARRAY, value)
					startArray()
					break
				}
				const iterator = /**@type Iterable<unknown>*/ (value)[Symbol.iterator]
				if (typeof iterator === "function") {
					startValue()
					newHead([], ITERATOR, iterator.call(value))
					startArray()
					break
				}
				const asyncIterator = /**@type AsyncIterable<unknown>*/ (value)[Symbol.asyncIterator]
				if (typeof asyncIterator === "function") {
					startValue()
					newHead([], ASYNC, asyncIterator.call(value))
					break
				}
				const proto = Object.getPrototypeOf(value)
				if (proto === objectProto || proto === null) {
					startValue()
					newHead(value, ENTRIES, Object.entries(value))
					startObject()
					break
				}
				if (value instanceof Number || value instanceof String || value instanceof Boolean) {
					startValue()
					pushChunk(JSON.stringify(value.valueOf()))
					break
				}
				if (value instanceof BigInt) {
					// we already called toJSON so we can throw now
					throw new TypeError("Do not know how to serialize a BigInt")
				}
				startValue()
				newHead(value, ENTRIES, Object.entries(value))
				startObject()
				break
			}
			default: {
				if (head?.type !== ENTRIES && head?.type !== ASYNC_ENTRIES) {
					startValue()
					pushChunk("null")
				}
			}
		}
	}

	const processObjectEntry = (/**@type [string, unknown]*/ entry) => {
		key = entry[0]
		head.currentIndex++
		if (propsFilter) {
			key = String(key ?? "")
			if (!propsFilter.has(key)) {
				return
			}
		}
		return processThenable(entry[1])
	}

	const processArrayItem = (/**@type unknown*/ item) => {
		key = head.currentIndex
		head.currentIndex++
		return processThenable(item)
	}

	const processThenable = (/**@type unknown*/ value) => {
		if (
			value !== null &&
			(typeof value === "object" || typeof value === "function") &&
			typeof (/**@type Promise<unknown>*/ (value).then) === "function" &&
			typeof (/**@type Iterable<unknown>*/ (value)[Symbol.iterator]) !== "function" &&
			typeof (/**@type AsyncIterable<unknown>*/ (value)[Symbol.asyncIterator]) !== "function"
		) {
			continuation = Promise.resolve(value).then(processValue)
			return
		}
		return processValue(value)
	}

	const asyncEntriesResult = (/**@type IteratorResult<[symbol|string, unknown]>*/ rec) => {
		if (!rec.done) {
			if (Array.isArray(rec.value) && rec.value.length === 2) {
				if (typeof rec.value[0] === "string") {
					return processObjectEntry(/**@type [string, unknown]*/ (rec.value))
				}
				continuation = head.items.next().then(asyncEntriesResult)
				return
			}
			throw new TypeError("Invalid entry")
		}
		closeObject()
	}

	const asyncStringResult = (/**@type IteratorResult<unknown>*/ rec) => {
		if (!rec.done) {
			if (!(rec.value instanceof Uint8Array)) {
				throw new TypeError("The whole stream should be binary")
			}
			const chunk = JSON.stringify(decoder.decode(rec.value, { stream: true })).slice(1, -1)
			pushChunk(chunk)
			continuation = head.items.next().then(asyncStringResult)
			return
		}
		// Pop head only after the items is completely consumed.
		// head.items are disposed in the finally block in case of some exceptions.
		head = stack.pop()
		const lastChunk = JSON.stringify(decoder.decode()).slice(1)
		pushChunk(lastChunk)
	}

	const asyncResult = (/**@type IteratorResult<unknown>*/ rec) => {
		if (!rec.done) {
			if (rec.value instanceof Uint8Array) {
				decoder ??= new TextDecoder()
				const firstChunk = JSON.stringify(decoder.decode(rec.value, { stream: true })).slice(0, -1)
				pushChunk(firstChunk)
				continuation = head.items.next().then(asyncStringResult)
				return
			}
			if (Array.isArray(rec.value) && rec.value.length === 2 && typeof rec.value[0] === "symbol") {
				head.type = ASYNC_ENTRIES
				head.object = undefined
				startObject()
				continuation = head.items.next().then(asyncEntriesResult)
				return
			}
		}
		startArray()
		head.type = ASYNC_ITERATOR
		return asyncIteratorResult(rec)
	}

	const asyncIteratorResult = (/**@type IteratorResult<unknown>*/ rec) => {
		if (!rec.done) {
			return processArrayItem(rec.value)
		}
		return closeArray()
	}

	const run = () => {
		while (head && !continuation && !hasBuffer()) {
			switch (head.type) {
				case ENTRIES: {
					if (head.currentIndex < head.items.length) {
						processObjectEntry(head.items[head.currentIndex])
						continue
					}
					closeObject()
					continue
				}
				case ARRAY: {
					if (head.currentIndex < head.items.length) {
						processArrayItem(head.items[head.currentIndex])
						continue
					}
					closeArray()
					continue
				}
				case ITERATOR: {
					const result = head.items.next()
					if (!result.done) {
						processArrayItem(result.value)
						continue
					}
					closeArray()
					continue
				}
				case ASYNC_ENTRIES: {
					continuation = head.items.next().then(asyncEntriesResult)
					return
				}
				case ASYNC_ITERATOR: {
					continuation = head.items.next().then(asyncIteratorResult)
					return
				}
				case ASYNC: {
					continuation = head.items.next().then(asyncResult)
					return
				}
			}
			throw new Error(`unreachable, ${head.type}`)
		}
	}

	try {
		processThenable(data)

		do {
			while (true) {
				if (hasBuffer()) {
					yield getBuffer()
					await pause
				}
				if (!continuation) break
				const p = continuation
				continuation = null
				await p
			}
			run()
		} while (continuation || head)
	} catch (error) {
		while (head || stack.length > 0) {
			try {
				await head?.items?.return?.()
			} catch {
				//
			}
			head = stack.pop()
		}
		throw error
	}
	if (ndjson && (bufferYielded || buffer.length > 0)) pushChunk("\n")

	// yield the last chunk if needed
	if (buffer.length > 0) yield getBuffer()

	// if no chunks were yielded yield an empty chunk to mark our stream as binary
	if (!bufferYielded) yield getBuffer()
}

const getPause = () => new Promise(setImmediate)

const parseIndent = (/**@type unknown*/ indent) => {
	if (!indent) return undefined
	if (typeof indent === "number") {
		if (indent <= 0) return undefined
		return "".padEnd(Math.min(10, indent), " ")
	}
	if (typeof indent !== "string") return undefined
	return indent.slice(0, 10)
}

//
// a helper to explicitely mark async stream as a string rather then as an array
//
export const asAsyncBuffer = (/**@type AsyncIterable<Uint8Array>*/ stream) =>
	stream instanceof AsyncBufferProxy ? stream : new AsyncBufferProxy(stream)

class AsyncBufferProxy {
	/**@type AsyncIterable<Uint8Array>*/
	#stream
	constructor(/**@type AsyncIterable<Uint8Array>*/ stream) {
		if (typeof stream?.[Symbol.asyncIterator] !== "function") {
			throw new TypeError("not an async iterator")
		}
		this.#stream = stream
	}
	async *[Symbol.asyncIterator]() {
		yield new Uint8Array()
		yield* this.#stream
	}
}

//
// a helper to explicitely mark async stream as an object (emits key-value pairs) rather then as an array
//
export const asAsyncObject = (/**@type AsyncIterable<[string | Symbol, unknown]>*/ stream) =>
	stream instanceof AsyncObjectProxy ? stream : new AsyncObjectProxy(stream)

const asyncObjectMark = Symbol("asyncObjectMark")

class AsyncObjectProxy {
	/**@type AsyncIterable<[string | Symbol, unknown]>*/
	#stream
	constructor(/**@type AsyncIterable<[string | Symbol, unknown]>*/ stream) {
		if (typeof stream?.[Symbol.asyncIterator] !== "function") {
			throw new TypeError("not an async iterator")
		}
		this.#stream = stream
	}
	async *[Symbol.asyncIterator]() {
		yield [asyncObjectMark, undefined]
		yield* this.#stream
	}
}

const objectProto = Object.getPrototypeOf({})
