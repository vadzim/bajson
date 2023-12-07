const ENTRIES = 0
const VALUES = 1
const ITERATOR = 2
const ASYNC = 3
const ASYNC_ARRAY = 4
const ASYNC_ENTRIES = 5

// type StackItem = {
// 	type: number
// 	items?: Iterator<unknown> | AsyncIterator<unknown> | [key: string, value: unknown][] | unknown[]
// 	index?: number
// 	commaNeeded?: boolean
// 	indentNeeded?: boolean
// 	dataPushed?: boolean
// 	key?: string
// }

export async function* stringify(
	data /*: unknown*/,
	replacer /*?: (key: string, value: unknown) => unknown*/,
	indent /*?: unknown*/,
	{ chunkSize = 10000 } /*: { chunkSize?: number }*/ = {},
) {
	const encoder = new TextEncoder()
	let head /*: StackItem | null*/ = null
	let buffer = ""
	let bufferYielded = false
	const stack /*: StackItem[]*/ = []
	const indents /*: string[]*/ = []

	indent = parseIndent(indent)

	if (typeof replacer !== "function") replacer = undefined

	const pushChunk = (chunk /*: string*/) => {
		buffer += chunk
		return buffer.length >= chunkSize
	}

	const pushData = (rec /*: StackItem | null*/, chunk /*: string*/) => {
		if (rec) {
			if (rec.commaNeeded) {
				pushChunk(",")
				rec.commaNeeded = false
			}
			if (rec.indentNeeded) {
				if (typeof indent === "string") {
					indents[rec.indentIndex] ||= (indents[rec.indentIndex - 1] ?? "\n") + indent
					pushChunk(indents[rec.indentIndex])
				}
				rec.indentNeeded = false
			}
			if (rec.key != null) {
				pushChunk(JSON.stringify(rec.key))
				pushChunk(typeof indent === "string" ? ": " : ":")
				rec.key = null
			}
			rec.dataPushed = true
		}
		return pushChunk(chunk)
	}

	const pushClose = (rec /*: StackItem | null*/, chunk /*: string*/) => {
		if (rec.dataPushed) {
			if (typeof indent === "string") {
				pushChunk(rec.indentIndex ? indents[rec.indentIndex - 1] : "\n")
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
		if (head) stack.push(head)
		head = {
			type,
			items,
			index: 0,
			commaNeeded: false,
			indentNeeded: false,
			dataPushed: false,
			key: null,
			indentIndex: stack.length,
		}
	}

	try {
		const processObjectEntry = entry => {
			head.commaNeeded ||= head.index > 0 && head.key == null
			head.key = entry[0]
			current = typeof head.key === "symbol" ? undefined : getValue(head.key, entry[1])
			head.index++
			head.indentNeeded = true
		}

		const processArrayItem = item => {
			head.commaNeeded = head.index > 0
			current = getValue(head.index, item)
			head.index++
			head.indentNeeded = true
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
							pushData(head, "[") && (yield getBuffer(), await pause)
							newHead(VALUES, current)
							break
						}
						const iterator = current[Symbol.iterator]
						if (typeof iterator === "function") {
							pushData(head, "[") && (yield getBuffer(), await pause)
							newHead(ITERATOR, iterator.call(current))
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
						if (head.index < head.items.length) {
							processObjectEntry(head.items[head.index])
							break loop
						}
						close = "}"
						break
					}
					case VALUES: {
						if (head.index < head.items.length) {
							processArrayItem(head.items[head.index])
							break loop
						}
						close = "]"
						break
					}
					case ITERATOR: {
						const result = head.items.next()
						if (!result.done) {
							processArrayItem(result.value)
							break loop
						}
						close = "]"
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
					case ASYNC: {
						const result = await head.items.next()

						if (head.index === 0) {
							const prevHead = stack[stack.length - 1]
							if (!result.done) {
								if (result.value instanceof Uint8Array) {
									const decoder = new TextDecoder()
									const firstChunk = JSON.stringify(decoder.decode(result.value, { stream: true })) //
										.slice(0, -1)
									pushData(prevHead, firstChunk) && (yield getBuffer(), await pause)
									for (let item; (item = await head.items.next()), !item.done; ) {
										if (!(item.value instanceof Uint8Array)) {
											throw new TypeError("The whole stream should be binary")
										}
										const chunk = JSON.stringify(decoder.decode(item.value, { stream: true })).slice(1, -1)
										pushData(prevHead, chunk) && (yield getBuffer(), await pause)
									}
									head = stack.pop()
									const lastChunk = JSON.stringify(decoder.decode()).slice(1)
									pushData(head, lastChunk) && (yield getBuffer(), await pause)
									continue
								} else if (
									Array.isArray(result.value) &&
									result.value.length === 2 &&
									typeof result.value[0] === "symbol"
								) {
									pushData(prevHead, "{") && (yield getBuffer(), await pause)
									head.type = ASYNC_ENTRIES
									processObjectEntry(result.value)
									break loop
								}
							}
							pushData(prevHead, "[") && (yield getBuffer(), await pause)
						}

						if (!result.done) {
							processArrayItem(result.value)
							break loop
						}
						close = "]"
						break
					}
					default: {
						throw new Error(`unreachable, ${head.type}`)
					}
				}
				pushClose(head, close) && (yield getBuffer(), await pause)
				head = stack.pop()
			}
		} while (head)
	} catch (error) {
		while (head || stack.length > 0) {
			switch (head?.type) {
				case ITERATOR: {
					try {
						head.items?.return()
					} catch {
						//
					}
					break
				}
				case ASYNC: {
					try {
						await head.items?.return()
					} catch {
						//
					}
					break
				}
			}
			head = stack.pop()
		}
		throw error
	}
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
