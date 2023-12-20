/**
 * @param {unknown} [data]
 * @param {undefined | ((key: string, value: unknown) => unknown)} [replacer=undefined]
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
		throw new Error("Either indent, ndjson or itemPerLine should be specified")
	}

	//
	//
	const ENTRIES = 0
	const ASYNC_ENTRIES = 1
	const ARRAY = 2
	const ITERATOR = 3
	const ASYNC_ITERATOR = 4
	const ASYNC_STRING = 5

	/**
	 * @typedef {
	 * 	| {
	 * 		type: ENTRIES
	 * 		items: Array<[string | Symbol, unknown]>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * 	| {
	 * 		type: ASYNC_ENTRIES
	 * 		items: AsyncIterator<[string | Symbol, unknown]>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * 	| {
	 * 		type: ARRAY
	 * 		items: Array<unknown>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * 	| {
	 * 		type: ITERATOR
	 * 		items: Iterator<unknown>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * 	| {
	 * 		type: ASYNC_ITERATOR
	 * 		items: AsyncIterator<unknown>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * 	| {
	 * 		type: ASYNC_STRING
	 * 		items: AsyncIterator<Uint8Array>
	 * 		currentIndex: number
	 * 		key: string
	 * }
	 * }  StackItem
	 */

	const encoder = new TextEncoder()
	/**@type StackItem | null*/
	let head = null
	let buffer = ""
	let bufferYielded = false
	/**@type Array<StackItem>*/
	const stack = []

	if (typeof replacer !== "function") replacer = undefined

	/**@type Array<string>*/
	const indentCache = []

	/**@returns {string}*/
	const getIndent = (/**@type number*/ indentIndex) =>
		indentIndex < 0 ? "\n" : (indentCache[indentIndex] ??= getIndent(indentIndex - 1) + parsedIndent)

	const pushChunk = (/**@type string*/ chunk) => {
		buffer += chunk
		return buffer.length >= chunkSize
	}

	/**@type Promise<unknown> | undefined*/
	let pause = undefined

	const getBuffer = () => {
		const result = encoder.encode(buffer)
		buffer = ""
		bufferYielded = true

		// create pause inside getBuffer and wait after yielding getBuffer result
		// to wait for pause while yielding ;)
		pause = getPause()

		return result
	}

	/**@return {unknown}*/
	const callToJSON = (/**@type string*/ key, /**@type unknown*/ value) => {
		const toJSON = /**@type undefined | { toJSON?: (key: string) => unknown }*/ (value)?.toJSON
		if (typeof toJSON === "function") {
			return toJSON.call(value, key)
		}
		return value
	}

	const getValue = (/**@type string*/ key, /**@type unknown*/ value) => {
		if (replacer) {
			value = replacer(key, value)
		}
		return callToJSON(key, value)
	}

	/**@return {StackItem}*/
	const newHead = (/**@type StackItem["type"]*/ type, /**@type StackItem["items"]*/ items) => {
		if (head) stack.push(head)
		head = {
			type,
			items,
			currentIndex: 0,
			dataPushed: false,
			key: "",
		}
	}

	const pushArrayStart = () => {
		if (ndjson && stack.length === 0) {
			return false
		}
		return pushChunk("[")
	}

	const pushArrayClose = () => {
		if (ndjson && stack.length === 0) {
			return false
		}
		if (head.dataPushed) {
			if (parsedIndent !== undefined) {
				pushChunk(getIndent(stack.length - 1))
			}
			if (itemPerLine && stack.length === 0) {
				pushChunk("\n")
			}
		}
		return pushChunk("]")
	}

	const pushObjectStart = () => {
		return pushChunk("{")
	}

	const pushObjectClose = () => {
		if (head.dataPushed) {
			if (parsedIndent !== undefined) {
				pushChunk(getIndent(stack.length - 1))
			}
			if (itemPerLine && stack.length === 0) {
				pushChunk("\n")
			}
		}
		return pushChunk("}")
	}

	const pushItemStart = () => {
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
			pushChunk(JSON.stringify(head.key))
			pushChunk(":")
			if (parsedIndent !== undefined) {
				pushChunk(" ")
			}
		}
	}

	try {
		const processObjectEntry = (/**@type [string | Symbol, unknown]*/ entry) => {
			if (typeof entry[0] === "symbol") {
				head.key = ""
				current = undefined
			} else {
				head.key = String(entry[0])
				current = getValue(head.key, entry[1])
			}
			head.currentIndex++
		}

		const processArrayItem = (/**@type unknown*/ item) => {
			head.key = String(head.currentIndex)
			current = getValue(head.key, item)
			head.currentIndex++
		}

		let current = getValue("", data)

		do {
			let convertPromise = true
			for (;;) {
				switch (typeof current) {
					case "number":
					case "boolean":
					case "string": {
						pushItemStart()
						const json = JSON.stringify(current)
						pushChunk(json) && (yield getBuffer(), await pause)
						break
					}
					case "object": {
						if (!current) {
							pushItemStart()
							pushChunk("null") && (yield getBuffer(), await pause)
							break
						}
						if (Array.isArray(current)) {
							pushItemStart()
							newHead(ARRAY, current)
							pushArrayStart() && (yield getBuffer(), await pause)
							break
						}
						const iterator = /**@type Iterable<unknown>*/ (current)[Symbol.iterator]
						if (typeof iterator === "function") {
							pushItemStart()
							newHead(ITERATOR, iterator.call(current))
							pushArrayStart() && (yield getBuffer(), await pause)
							break
						}
						const asyncIterator = /**@type AsyncIterable<unknown>*/ (current)[Symbol.asyncIterator]
						if (typeof asyncIterator === "function") {
							pushItemStart()
							newHead(ASYNC_ITERATOR, asyncIterator.call(current))
							break
						}
						if (convertPromise && typeof (/**@type Promise<unknown>*/ (current).then) === "function") {
							current = getValue(head?.key ?? "", await current)
							convertPromise = false
							continue
						}
						pushItemStart()
						newHead(ENTRIES, Object.entries(current))
						pushObjectStart() && (yield getBuffer(), await pause)
						break
					}
					default: {
						if (head?.type !== ENTRIES && head?.type !== ASYNC_ENTRIES) {
							pushItemStart()
							pushChunk("null") && (yield getBuffer(), await pause)
						}
					}
				}
				break
			}
			loop: while (head) {
				let close
				switch (head.type) {
					case ENTRIES: {
						if (head.currentIndex < head.items.length) {
							processObjectEntry(head.items[head.currentIndex])
							break loop
						}
						close = pushObjectClose
						break
					}
					case ARRAY: {
						if (head.currentIndex < head.items.length) {
							processArrayItem(head.items[head.currentIndex])
							break loop
						}
						close = pushArrayClose
						break
					}
					case ITERATOR: {
						const result = head.items.next()
						if (!result.done) {
							processArrayItem(result.value)
							break loop
						}
						close = pushArrayClose
						break
					}
					case ASYNC_ENTRIES: {
						const result = await head.items.next()
						if (!result.done) {
							if (
								!Array.isArray(result.value) ||
								result.value.length !== 2 ||
								(typeof result.value[0] !== "string" && typeof result.value[0] !== "symbol")
							) {
								throw new TypeError("Invalid entries")
							}
							processObjectEntry(result.value)
							break loop
						}
						close = pushObjectClose
						break
					}
					case ASYNC_STRING: {
						const prevHead = stack[stack.length - 1]
						const decoder = new TextDecoder()
						const firstChunk = JSON.stringify(
							decoder.decode(/**@type IteratorResult<unknown>*/ (current).value, { stream: true }),
						).slice(0, -1)
						pushChunk(firstChunk) && (yield getBuffer(), await pause)
						for (
							/**@type IteratorResult<unknown>*/
							let rec;
							(rec = await head.items.next()), !rec.done;

						) {
							if (!(rec.value instanceof Uint8Array)) {
								throw new TypeError("The whole stream should be binary")
							}
							const chunk = JSON.stringify(decoder.decode(rec.value, { stream: true })).slice(1, -1)
							pushChunk(chunk) && (yield getBuffer(), await pause)
						}
						// Pop head only after the items is completely consumed.
						// head.items are disposed in the finally block in case of some exceptions.
						head = stack.pop()
						const lastChunk = JSON.stringify(decoder.decode()).slice(1)
						pushChunk(lastChunk) && (yield getBuffer(), await pause)
						continue
					}
					case ASYNC_ITERATOR: {
						const result = await head.items.next()

						if (head.currentIndex === 0) {
							if (!result.done) {
								if (result.value instanceof Uint8Array) {
									current = result
									head.type = ASYNC_STRING
									continue
								}
								if (
									Array.isArray(result.value) &&
									result.value.length === 2 &&
									typeof result.value[0] === "symbol"
								) {
									head.type = ASYNC_ENTRIES
									pushObjectStart() && (yield getBuffer(), await pause)
									processObjectEntry(result.value)
									break loop
								}
							}
							pushArrayStart() && (yield getBuffer(), await pause)
						}

						if (!result.done) {
							processArrayItem(result.value)
							break loop
						}
						close = pushArrayClose
						break
					}
					default: {
						throw new Error(`unreachable, ${head.type}`)
					}
				}
				close?.() && (yield getBuffer(), await pause)
				head = stack.pop()
			}
		} while (head)
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
