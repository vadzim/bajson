const CODE_n = "n".charCodeAt(0)
const CODE_t = "t".charCodeAt(0)
const CODE_f = "f".charCodeAt(0)
const CODE_0 = "0".charCodeAt(0)
const CODE_9 = "9".charCodeAt(0)
const CODE_QUOTE = '"'.charCodeAt(0)
const CODE_CLEFT = "{".charCodeAt(0)
const CODE_CRIGHT = "}".charCodeAt(0)
const CODE_SLEFT = "[".charCodeAt(0)
const CODE_SRIGHT = "]".charCodeAt(0)
const CODE_SPACE = " ".charCodeAt(0)
const CODE_NL = "\n".charCodeAt(0)
const CODE_CR = "\r".charCodeAt(0)
const CODE_TAB = "\t".charCodeAt(0)
const CODE_DOT = ".".charCodeAt(0)
const CODE_e = "e".charCodeAt(0)
const CODE_E = "E".charCodeAt(0)
const CODE_PLUS = "+".charCodeAt(0)
const CODE_MINUS = "-".charCodeAt(0)

const TEXT_NULL = new TextEncoder().encode("null")

/**@return Promise<ParsedJSON<undefined>>*/
export function parse(/**@type AsyncIterable<Uint8Array>*/ data) {
	let { resolve: resolveTuple, promise: resultTuple } = makePromise()
	const decoder = new TextDecoder()

	let resolveValue
	const stack = new Uint8Array(2000)
	stack[0] = FINISHING
	let stackIndex = 0
	let inlineIndex = 0
	const string = new Uint8Array(8 * 1024)
	let stringIndex = 0
	let mode = WAITING_KEY
	let unicode = 0
	let unicodeIndex = 0
	let i = 0
	let chunk
	const values = []
	let collectIndex = 0
	let skipping = false
	let inlining = false
	let key = undefined
	let consumedCallback
	const unicodeEncoder = new TextEncoder()
	const unicodeDecoder = new TextDecoder()

	const unexpectedToken = () => {
		throw new SyntaxError(`Unexpected token '${String.fromCharCode(chunk[i])}'`)
	}

	const pushStringChunk = () => {
		if (stack[stackIndex] === WAITING_KEY) unexpectedToken()
		if (collectIndex === stackIndex) {
			resolvers[resolversIndex]({ done: false, value: string.subarray(0, stringIndex) })
			stringIndex = 0
			return true
		}
		values[values.length - 1] += unicodeDecoder.decode(string.subarray(0, stringIndex), { stream: true })
		return false
	}

	const getKey = () => {
		const result = unicodeDecoder.decode(string.subarray(0, stringIndex))
		stringIndex = 0
		return result
	}

	const enumerateIterableValue = type => {
		return {
			key,
			type,
			value: new IterableThenable(
				() => {
					if (resolveValue) throw new Error("unreachable")
					const { promise, resolve } = makePromise()
					resolveValue = resolve
					Promise.resolve().then(onChunk)
					return promise.then(value => ({ done: false, value }))
				},
				() => {
					if (resolveValue) throw new Error("unreachable")
					inlining = false
					skipping = true
					inlineIndex = stackIndex
					const { promise, resolve } = makePromise()
					resolveValue = resolve
					if (stackIndex === 1) streamIterator.return()
					Promise.resolve().then(onChunk)
					return promise.then(() => ({ done: true }))
				},
				() => {
					if (resolveValue) throw new Error("unreachable")
					inlining = true
					skipping = false
					inlineIndex = stackIndex
					if (mode === READING_STRING) values.push("")
					else if (stack[stackIndex] === READING_OBJECT) values.push({})
					else if (stack[stackIndex] === READING_ARRAY) values.push([])
					else throw new Error("unreachable")
					const { promise, resolve } = makePromise()
					resolveValue = resolve
					Promise.resolve().then(onChunk)
					return promise
				},
				cb => {
					consumedCallback = cb
				},
			),
		}
	}

	const onChunk = () => {
		while (i < chunk.length) {
			const char = chunk[i]
			switch (mode) {
				case WAITING_VALUE: {
					switch (char) {
						case CODE_CLEFT: {
							stack[++stackIndex] = READING_OBJECT
							if (stackIndex === stack.length) unexpectedToken()
							mode = WAITING_KEY
							if (inlining) values.push({})
							else if (!skipping) return enumerateIterableValue("object"), true
							break
						}
						case CODE_SLEFT: {
							stack[++stackIndex] = READING_ARRAY
							if (stackIndex === stack.length) unexpectedToken()
							mode = WAITING_VALUE
							if (inlining) values.push([])
							else if (!skipping) return enumerateIterableValue("array"), true
							break
						}
						case CODE_QUOTE: {
							stack[++stackIndex] = mode
							mode = READING_STRING
							if (inlining) values.push("")
							else if (!skipping) return enumerateIterableValue("string"), true
							break
						}
						case CODE_SPACE:
						case CODE_NL:
						case CODE_CR:
						case CODE_TAB:
							break
						default:
							unexpectedToken()
					}
					break
				}
				case WAITING_KEY: {
					switch (char) {
						case CODE_QUOTE: {
							stack[++stackIndex] = mode
							if (stackIndex === stack.length) unexpectedToken()
							mode = WAITING_COLUMN
							break
						}
						case CODE_SPACE:
						case CODE_NL:
						case CODE_CR:
						case CODE_TAB:
							break
						default:
							unexpectedToken()
					}
					break
				}
				case WAITING_COLUMN: {
					switch (char) {
						case CODE_COLUMN: {
							mode = WAITING_VALUE
							break
						}
						case CODE_SPACE:
						case CODE_NL:
						case CODE_CR:
						case CODE_TAB:
							break
						default:
							unexpectedToken()
					}
					break
				}
				case READING_STRING: {
					if (char === CODE_QUOTE) {
						mode = stack[stackIndex--]
						switch (mode) {
							case WAITING_COLUMN: {
								key = getKey()
								break
							}
							default: {
								if (stringIndex > 0 && pushStringChunk()) return i++, true
								switch (stack[stackIndex]) {
									case READING_OBJECT: {
										cb("field", getString())
										break
									}
									case READING_ARRAY: {
										cb("item", getString())
										break
									}
									case FINISHING: {
										cb("result", getString())
										break
									}
								}
							}
						}
						break
					}
					if (stringIndex === string.length) if (pushStringChunk()) return true
					switch (char) {
						case CODE_BACKSLASH: {
							mode = READING_BACKSLASH
							break
						}
						case CODE_CR:
						case CODE_LF:
						case CODE_NL:
						case CODE_BS:
							unexpectedToken()
						default: {
							string[stringIndex++] = char
							break
						}
					}
					break
				}
				case READING_BACKSLASH: {
					switch (char) {
						case CODE_n: {
							string[stringIndex++] = CODE_NL
							mode = READING_STRING
							break
						}
						case CODE_r: {
							string[stringIndex++] = CODE_CR
							mode = READING_STRING
							break
						}
						case CODE_t: {
							string[stringIndex++] = CODE_TAB
							mode = READING_STRING
							break
						}
						case CODE_b: {
							string[stringIndex++] = CODE_BS
							mode = READING_STRING
							break
						}
						case CODE_f: {
							string[stringIndex++] = CODE_LF
							mode = READING_STRING
							break
						}
						case CODE_SLASH:
						case CODE_BACKSLASH:
						case CODE_QUOTE: {
							string[stringIndex++] = char
							mode = READING_STRING
							break
						}
						case CODE_u: {
							if (stringIndex >= string.length - 4) if (pushStringChunk()) return true
							mode = READING_UNICODE
							break
						}
						default:
							unexpectedToken()
					}
					break
				}
				case READING_UNICODE: {
					unicode *= 16
					unicode +=
						char -
						(char >= CODE_0 && char <= CODE_9
							? CODE_0
							: char >= CODE_a && char <= CODE_f
							  ? CODE_a
							  : char >= CODE_A && char <= CODE_F
							    ? CODE_A
							    : unexpectedToken())
					unicodeIndex++
					if (unicodeIndex === 4) {
						if (unicode < 0x1_0000) {
							if (unicode >= 0xdc00 && unicode < 0xe000) unexpectedToken()
							if (unicode >= 0xd800 && unicode < 0xdc00) {
								unicode <<= 16
								unicodeIndex = 0
								mode = WAITING_UNICODE
								break
							}
						} else {
							if ((unicode & 0xffff) < 0xdc00 || (unicode & 0xffff) >= 0xe000) unexpectedToken()
							unicode = (unicode >> 16) - 0xd800 + (unicode & 0xffff) - 0xdc00
						}
						if (unicode < 0b1_000_0000) {
							string[stringIndex++] = unicode
						} else if (unicode < 0b1_00000_000000) {
							string[stringIndex] = 0b1100_0000 + (unicode >> 6)
							string[stringIndex + 1] = 0b1000_0000 + (unicode & 0b11_1111)
							stringIndex += 2
						} else if (unicode < 0b1_0000_000000_000000) {
							string[stringIndex] = 0b1110_0000 + (unicode >> 12)
							string[stringIndex + 1] = 0b1000_0000 + ((unicode >> 6) & 0b11_1111)
							string[stringIndex + 2] = 0b1000_0000 + (unicode & 0b11_1111)
							stringIndex += 3
						} else if (unicode < 0b1_000_000000_000000_000000) {
							string[stringIndex] = 0b1111_0000 + (unicode >> 18)
							string[stringIndex + 1] = 0b1000_0000 + ((unicode >> 12) & 0b11_1111)
							string[stringIndex + 2] = 0b1000_0000 + ((unicode >> 6) & 0b11_1111)
							string[stringIndex + 3] = 0b1000_0000 + (unicode & 0b11_1111)
							stringIndex += 4
						} else unexpectedToken()
						unicode = 0
						unicodeIndex = 0
						mode = READING_STRING
					}
					break
				}
				case WAITING_UNICODE: {
					if (char !== CODE_BACKSLASH) unexpectedToken()
					mode = WAITING_UNICODE_2
					break
				}
				case WAITING_UNICODE_2: {
					if (char !== CODE_u) unexpectedToken()
					mode = READING_UNICODE
					break
				}
				case FINISHING: {
					switch (char) {
						case CODE_SPACE:
						case CODE_NL:
						case CODE_CR:
						case CODE_TAB:
							break
						default:
							unexpectedToken()
					}
					break
				}
			}
			i++
		}
		return false
	}

	void (async () => {
		for await (chunk of data) {
			i = 0
			onChunk()
		}
	})()

	return promise
}

const makePromise = () => {
	let resolve
	const promise = new Promise(r => (resolve = r))
	return { promise, resolve }
}

class IterableThenable {
	#next
	#return
	#collect
	#iteratorConsumed = false
	#promiseConsumed = false
	#result
	#chunk
	constructor(next, return_, collect, onConsume) {
		this.#next = next
		this.#return = return_
		onConsume(() => (this.#iteratorConsumed = this.#promiseConsumed = true))
	}
	static get [Symbol.species]() {
		return Promise
	}
	next() {
		if (this.#promiseConsumed) throw new Error("The value has been consumed")
		this.#iteratorConsumed = true
		this.#chunk ??= Promise.resolve()
		this.#chunk = this.#chunk.then(() => this.#next().then(value => ({ done: false, value })))
		return this.#chunk
	}
	return() {
		if (this.#promiseConsumed) throw new Error("The value has been consumed")
		this.#iteratorConsumed = true
		this.#chunk ??= Promise.resolve()
		this.#chunk = this.#chunk.then(() => this.#return().then(() => ({ done: true })))
		return this.#chunk
	}
	[Symbol.asyncIterator]() {
		if (this.#iteratorConsumed || this.#promiseConsumed) throw new Error("The value has been consumed")
		this.#iteratorConsumed = true
		return this
	}
	#read() {
		if (this.#iteratorConsumed) throw new Error("The value has been consumed")
		if (!this.#promiseConsumed) {
			this.#result = this.#collect()
			this.#promiseConsumed = true
		}
		return this.#result
	}
	then(resolve, reject) {
		return this.#read().then(resolve, reject)
	}
	catch(cb) {
		return this.#read().catch(cb)
	}
	finally(cb) {
		return this.#read().finally(cb)
	}
}

// async function collectString(stream) {
// 	let result = ""
// 	let decoder = new TextDecoder()
// 	for await (const chunk of stream) result += decoder.decode(chunk, { stream: true })
// 	result += decoder.decode()
// 	return result
// }

// async function collectObject(stream) {
// 	const result = {}
// 	for await (const { key, value } of stream) result[key] = await value
// 	return result
// }

// async function collectArray(stream) {
// 	const result = []
// 	for await (const { value } of stream) result.push(await value)
// 	return result
// }
