// test import
import "../index.cjs"
import "../index.js"

// main test
import { stringify, asAsyncObject } from "../index.js"
import * as fs from "node:fs"
import { pipeline } from "node:stream/promises"
import assert from "node:assert/strict"
import { test, describe } from "node:test"
import { inspect } from "node:util"

const inspectOptions = {
	compact: true,
	breakLength: Infinity,
	colors: true,
	depth: Infinity,
}

const toArray = async asyncIterable => {
	const ret = []
	for await (const item of asyncIterable) {
		ret.push(item)
	}
	return ret
}

const isPlainObject = value =>
	value && (!Object.getPrototypeOf(value) || Object.getPrototypeOf(value) === Object.getPrototypeOf({}))

const toPlain = async data => {
	data = await data
	if (data && typeof data === "object" && !(data instanceof Uint8Array)) {
		if (typeof data[Symbol.iterator] === "function") {
			return await Promise.all((await toArray(data)).map(toPlain))
		} else if (typeof data[Symbol.asyncIterator] === "function") {
			const array = await Promise.all((await toArray(data)).map(toPlain))
			if (array[0] instanceof Uint8Array) return await new Blob(array).text()
			if (Array.isArray(array[0]) && array[0].length === 2 && typeof array[0][0] === "symbol") {
				if (String(array[0][0]) === "Symbol(asyncObjectMark)" && array[0][1] === undefined) {
					return Object.fromEntries(array.slice(1))
				}
				return Object.fromEntries(array)
			}
			return array
		} else if (isPlainObject(data)) {
			return Object.fromEntries(
				await Promise.all(Object.entries(data).map(async ([k, v]) => [k, await toPlain(v)])),
			)
		}
	}
	return data
}

const ndjsonStringify = (value, replacer, indent) => {
	value = JSON.parse(JSON.stringify(value, replacer) ?? "null")
	return (Array.isArray(value) ? value : [value])
		.map(item => (JSON.stringify(item, undefined, indent) ?? "null") + "\n")
		.join("")
}

const itemPerLineStringify = (value, replacer, indent) => {
	value = JSON.parse(JSON.stringify(value, replacer) ?? "null")

	const joinItems = ([open = "", close = ""], items) =>
		open + items.map(item => item + "\n").join(",") + close

	if (Array.isArray(value))
		return joinItems(
			"[]",
			value.map(item => JSON.stringify(item, undefined, indent) ?? "null"),
		)
	if (value && typeof value === "object") {
		return joinItems(
			"{}",
			Object.entries(value).map(
				([key, item]) => JSON.stringify(String(key)) + ":" + JSON.stringify(item, undefined, indent),
			),
		)
	}
	return JSON.stringify(value, undefined, indent) ?? "null"
}

const getText = async (data, replacer, options) => {
	const decoder = new TextDecoder()
	let text = ""
	for await (const chunk of stringify(data, replacer, options)) {
		text += decoder.decode(chunk, { stream: true })
	}
	text += decoder.decode()
	return text
}

const fixText = text => new TextDecoder().decode(new TextEncoder().encode(text))

const date = new Date()

await describe("main", async () => {
	for (const data of [
		() => true,
		() => false,
		() => null,
		() => "",
		() => [],
		() => ({}),
		() => "abc",
		() => "ab\n\t❤️😱c",
		() => 1234,
		() => date,
		() => ({ a: 99 }),
		() => ({ a: Promise.resolve(199) }),
		() => ({ a: Promise.resolve({ b: 299 }) }),
		() => [399],
		() => [Promise.resolve(499)],
		() => [Promise.resolve({ b: 599 })],
		() => ({ "": 12, "***": 23, 34: 45 }),
		() => ({ a: 123, b: null, c: "str", d: [], e: {}, f: [345], g: { h: 567 } }),
		() => ({
			x: {
				x: {
					x: {
						x: { x: { x: { x: { x: { x: { x: { x: { x: { x: { x: { x: { x: { x: {} } } } } } } } } } } } } },
					},
				},
			},
		}),
		() => ({ [Symbol()]: 123, b: 321 }),
		() => ((x = { a: 17, toJSON: () => ({ ...x }) }) => x)(),
		() => ((x = { a: 117, toJSON: () => ({ a: 1117 }) }) => x)(),
		() => ((x = { a: 117, toJSON: b => ({ b }) }) => x)(),
		() => ((x = Promise.resolve({ a: 27, toJSON: () => ({ ...x }) })) => x)(),
		() => ((x = { a: 37, toJSON: () => Promise.resolve({ ...x }) }) => x)(),
		() => ({ a: { toJSON: k => k } }),
		() => ({ b: Promise.resolve({ toJSON: k => k }) }),
		...[
			() => [
				{ toJSON: k => k },
				{ toJSON: k => ({ [k]: k }) },
				Promise.resolve(33),
				(function* () {
					yield { x: 44 }
					yield Promise.resolve(55)
					yield 77
				})(),
				(async function* () {
					yield Promise.resolve(88)
					yield [99]
				})(),
				stringify({
					a: 42,
					b: 55,
					c: [89, 34, [{}]],
				}),
				asAsyncObject(
					(async function* () {
						yield* [
							["aa", 42],
							["bb", 55],
							["cc", [89, 34, [{}]]],
						]
					})(),
				),
			],
			() => [[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]],
			() => [undefined, () => {}, null, Symbol(), date],
			() => [
				undefined,
				undefined,
				undefined,
				42,
				undefined,
				undefined,
				undefined,
				42,
				undefined,
				undefined,
				undefined,
			],
			() => [undefined, 42, undefined, 42, undefined],
			() => [undefined, undefined, undefined, undefined, undefined, 42, undefined, undefined],
			() => [, , , , , 42],
			() => [, , , , , 42, , , ,],
			() => [date, date, date, date],
		].flatMap(a => [
			() => a(),
			() => Object.fromEntries(Object.entries(a())),
			() => Object.fromEntries(Object.entries(a()).map(([k, v]) => [3 - k, v])),
			() => Object.fromEntries(Object.entries(a()).map(([k, v]) => ["x" + k, v])),
			() => Object.fromEntries(Object.entries(a()).map(([k, v]) => ["x" + (3 - k), v])),
		]),
	]) {
		const plainData = await toPlain(data())

		await test(`with data = ${inspect(plainData, inspectOptions)}`, async () => {
			/**
			 * @param {unknown} replacer
			 * @param {unknown} indent
			 */
			const checkStdStringify = async (replacer = undefined, indent = undefined) => {
				const getTextResult = await getText(data(), replacer, indent)
				const jsonStringifyResult = fixText(JSON.stringify(plainData, replacer, indent))
				assert.equal(getTextResult, jsonStringifyResult)
			}
			checkStdStringify("string")

			await test("indents", async () => {
				for (const indent of [
					"",
					undefined,
					null,
					false,
					true,
					Symbol.iterator,
					() => {},
					{},
					[],
					"\x20",
					"\x20\x20",
					"\x20\x20\x20",
					"".padEnd(15, "\x20"),
					"\t",
					"\t\t",
					"\t\t\t",
					"".padEnd(15, "\t"),
					"w",
					"ww",
					"www",
					"".padEnd(15, "w"),
					"x".padEnd(16, "😱"),
					0,
					-0,
					1,
					3,
					-1,
					Infinity,
					11,
					88,
					3.1416,
					2.71,
					0.1,
					0.001,
					-3.1416,
					-2.71,
					-0.1,
					-0.001,
				]) {
					await test(`with indent = ${inspect(indent, inspectOptions)}`, async () => {
						await checkStdStringify(undefined, indent)
					})
				}
			})
			await test("with a replacer", async () => {
				await checkStdStringify((k, x) => (typeof x === "object" ? x : String(x)))
			})
			await test("with a wrong replacer", async () => {
				await checkStdStringify("string")
			})
			await test("ndjson", async () => {
				const getTextResult = await getText(data(), undefined, { ndjson: true })
				const jsonStringifyResult = fixText(ndjsonStringify(plainData))
				assert.equal(getTextResult, jsonStringifyResult)
			})
			await test("itemPerLine", async () => {
				const getTextResult = await getText(data(), undefined, { itemPerLine: true })
				const jsonStringifyResult = fixText(itemPerLineStringify(plainData))
				assert.equal(getTextResult, jsonStringifyResult)
			})
		})
	}
})

const time = async func => {
	const start = process.cpuUsage()
	const result = await func()
	const stop = process.cpuUsage(start)
	const duration = stop.user + stop.system
	return [duration / 1_000_000, result]
}

await test("performance", async () => {
	const [dataDuration, data] = await time(() =>
		[...new Array(300)].map((_, index) =>
			Object.fromEntries(
				[...new Array(100)].map((_, index) => [
					"c" + index,
					[...new Array(100)].map((_, index) => ["b" + index, [Math.random(), Math.random(), Math.random()]]),
				]),
			),
		),
	)
	const [jsonDuration, json] = await time(() => JSON.stringify(data))
	const [textDuration, textSize] = await time(async () => {
		let size = 0
		for await (const chunk of stringify(data)) size += chunk.length
		return size
	})
	if (textDuration > jsonDuration * 5) {
		assert.equal({ textDuration, jsonDuration }, {})
	}
})
