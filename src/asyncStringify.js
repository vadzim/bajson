const ENTRIES = 0
const VALUES = 1
const ITERATOR = 2
const ASYNC = 3
const ASYNC_ENTRIES = 4
const ASYNC_STRING = 5

// type StackItem = {
// 	type: number
// 	items?: Iterator<unknown> | AsyncIterator<unknown> | [key: string, value: unknown][] | unknown[]
// 	currentCount?: number
// 	commaNeeded?: boolean
// 	indentNeeded?: boolean
// 	key?: string
// }

export async function* stringify(
	data /*: unknown*/,
	replacer /*?: (key: string, value: unknown) => unknown*/,
	indent /*?: unknown*/,
	{ chunkSize = 10000, ndjson = false } /*: { chunkSize?: number, ndjson?: boolean }*/ = {},
) {
	const encoder = new TextEncoder()
	let head /*: StackItem | null*/ = null
	let buffer = ""
	let bufferYielded = false
	const stack /*: StackItem[]*/ = []
	const indents /*: string[]*/ = []

	indent = parseIndent(indent)

	if (typeof replacer !== "function") replacer = undefined

	const getIndent = (indentIndex /*: number*/) =>
		indentIndex < 0 ? "\n" : (indents[indentIndex] ??= getIndent(indentIndex - 1) + indent)

	const pushChunk = (chunk /*: string*/) => {
		buffer += chunk
		return buffer.length >= chunkSize
	}

	const pushData = (rec /*: StackItem | null*/, chunk /*: string*/) => {
		if (rec) {
			if (rec.nlNeeded) {
				pushChunk("\n")
				rec.nlNeeded = false
			}
			if (rec.commaNeeded) {
				pushChunk(",")
				rec.commaNeeded = false
			}
			if (rec.indentNeeded) {
				if (typeof indent === "string") {
					pushChunk(getIndent(rec.indentIndex))
				}
				rec.indentNeeded = false
			}
			if (rec.key != null) {
				pushChunk(JSON.stringify(rec.key))
				pushChunk(typeof indent === "string" ? ": " : ":")
				rec.key = null
			}
		}
		return pushChunk(chunk)
	}

	const pushArrayStart = () => {
		const prevHead = stack[stack.length - 1]
		if (prevHead || !ndjson) {
			return pushData(prevHead, "[")
		} else {
			head.indentIndex = -1
		}
	}

	const pushClose = (rec /*: StackItem | null*/, chunk /*: string*/) => {
		if (rec.currentCount > 0) {
			if (typeof indent === "string") {
				pushChunk(getIndent(rec.indentIndex - 1))
			}
		}
		return pushChunk(chunk)
	}

	let pause

	const getBuffer = () => {
		const result = encoder.encode(buffer)
		buffer = ""
		bufferYielded = true

		// create pause inside getBuffer and wait after yielding getBuffer result
		// to wait for pause while yielding ;)
		pause = getPause()

		return result
	}

	const callToJSON = (value /*: unknown*/) /*: unknown*/ => {
		const toJSON = value?.toJSON
		if (typeof toJSON === "function") value = toJSON.call(value)
		return value
	}

	const getValue = (key /*: unknown*/, value /*: unknown*/) /*: unknown*/ => {
		if (replacer) value = replacer(String(key), value)
		return callToJSON(value)
	}

	const newHead = (type /*: number*/, items /*: unknown*/) => {
		const prevHead = head
		if (head) stack.push(head)
		head = {
			type,
			items,
			currentCount: 0,
			nlNeeded: false,
			commaNeeded: false,
			indentNeeded: false,
			key: null,
			indentIndex: (prevHead ? prevHead.indentIndex : -1) + 1,
		}
	}

	const processCloseArray = () => (!ndjson || stack.length > 0 ? "]" : "")

	try {
		const processObjectEntry = entry => {
			head.nlNeeded = false
			head.commaNeeded ||= head.currentCount > 0 && head.key == null
			head.indentNeeded = true
			head.key = entry[0]
			current = typeof head.key === "symbol" ? undefined : getValue(head.key, entry[1])
			head.currentCount++
		}

		const processArrayItem = item => {
			if (ndjson && stack.length === 0) {
				head.nlNeeded = head.currentCount > 0
				head.commaNeeded = false
				head.indentNeeded = false
			} else {
				head.nlNeeded = false
				head.commaNeeded = head.currentCount > 0
				head.indentNeeded = true
			}
			current = getValue(head.currentCount, item)
			head.currentCount++
		}

		let current = getValue("", data)

		do {
			let convertPromise = true
			for (;;) {
				switch (typeof current) {
					case "number":
					case "boolean":
					case "string": {
						const json = JSON.stringify(current)
						pushData(head, json) && (yield getBuffer(), await pause)
						break
					}
					case "object": {
						if (!current) {
							pushData(head, "null") && (yield getBuffer(), await pause)
							break
						}
						if (Array.isArray(current)) {
							newHead(VALUES, current)
							pushArrayStart() && (yield getBuffer(), await pause)
							break
						}
						const iterator = current[Symbol.iterator]
						if (typeof iterator === "function") {
							newHead(ITERATOR, iterator.call(current))
							pushArrayStart() && (yield getBuffer(), await pause)
							break
						}
						const asyncIterator = current[Symbol.asyncIterator]
						if (typeof asyncIterator === "function") {
							newHead(ASYNC, asyncIterator.call(current))
							break
						}
						if (convertPromise && typeof current.then === "function") {
							current = getValue(head?.key ?? "", await current)
							convertPromise = false
							continue
						}
						pushData(head, "{") && (yield getBuffer(), await pause)
						newHead(ENTRIES, Object.entries(current))
						break
					}
					default: {
						if (head?.type !== ENTRIES && head?.type !== ASYNC_ENTRIES) {
							pushData(head, "null") && (yield getBuffer(), await pause)
						}
					}
				}
				break
			}
			loop: while (head) {
				let close
				switch (head.type) {
					case ENTRIES: {
						if (head.currentCount < head.items.length) {
							processObjectEntry(head.items[head.currentCount])
							break loop
						}
						close = "}"
						break
					}
					case VALUES: {
						if (head.currentCount < head.items.length) {
							processArrayItem(head.items[head.currentCount])
							break loop
						}
						close = processCloseArray()
						break
					}
					case ITERATOR: {
						const result = head.items.next()
						if (!result.done) {
							processArrayItem(result.value)
							break loop
						}
						close = processCloseArray()
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
						close = "}"
						break
					}
					case ASYNC_STRING: {
						const prevHead = stack[stack.length - 1]
						const decoder = new TextDecoder()
						const firstChunk = JSON.stringify(decoder.decode(current.value, { stream: true })) //
							.slice(0, -1)
						pushData(prevHead, firstChunk) && (yield getBuffer(), await pause)
						for (; (current = await head.items.next()), !current.done; ) {
							if (!(current.value instanceof Uint8Array)) {
								throw new TypeError("The whole stream should be binary")
							}
							const chunk = JSON.stringify(decoder.decode(current.value, { stream: true })).slice(1, -1)
							pushData(prevHead, chunk) && (yield getBuffer(), await pause)
						}
						// Pop head only after the items is completely consumed.
						// head.items are disposed in the finally block in case of some exceptions.
						head = stack.pop()
						const lastChunk = JSON.stringify(decoder.decode()).slice(1)
						pushData(head, lastChunk) && (yield getBuffer(), await pause)
						continue
					}
					case ASYNC: {
						const result = await head.items.next()

						if (head.currentCount === 0) {
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
									const prevHead = stack[stack.length - 1]
									pushData(prevHead, "{") && (yield getBuffer(), await pause)
									head.type = ASYNC_ENTRIES
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
						close = processCloseArray()
						break
					}
					default: {
						throw new Error(`unreachable, ${head.type}`)
					}
				}
				close && pushClose(head, close) && (yield getBuffer(), await pause)
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
	if (ndjson && (bufferYielded || buffer)) pushData(undefined, "\n")
	if (!bufferYielded || buffer) yield getBuffer()
}

const getPause = () => new Promise(setImmediate)

const parseIndent = indent => {
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
export const asAsyncBuffer = (stream /*: AsyncIterable<unknown>*/) =>
	stream instanceof AsyncBufferProxy ? stream : new AsyncBufferProxy(stream)

class AsyncBufferProxy {
	#stream /*: AsyncIterator<unknown>*/
	constructor(stream /*: AsyncIterator<unknown>*/) {
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
export const asAsyncObject = (stream /*: AsyncIterable<unknown>*/) =>
	stream instanceof AsyncObjectProxy ? stream : new AsyncObjectProxy(stream)

const asyncObjectMark = Symbol("asyncObjectMark")

class AsyncObjectProxy {
	#stream /*: AsyncIterator<unknown>*/
	constructor(stream /*: AsyncIterator<unknown>*/) {
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
