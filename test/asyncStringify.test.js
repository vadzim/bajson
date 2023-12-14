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

const toPlain = async data => {
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
		} else if (Object.getPrototypeOf(data) === Object.getPrototypeOf({})) {
			return Object.fromEntries(
				await Promise.all(Object.entries(data).map(async ([k, v]) => [k, await toPlain(v)])),
			)
		} else if (typeof data.then === "function") {
			return await toPlain(await data)
		}
	}
	return data
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
		() => ((x = { a: 1, toJSON: () => ({ ...x }) }) => x)(),
		() => ((x = Promise.resolve({ a: 1, toJSON: () => ({ ...x }) })) => x)(),
		() => ((x = { a: 1, toJSON: () => Promise.resolve({ ...x }) }) => x)(),
		...[
			() => [
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
			const check = async (replacer = undefined, indent = undefined) => {
				await test("without ndjson", async () => {
					const getTextResult = await getText(data(), replacer, indent)
					const jsonStringifyResult = fixText(JSON.stringify(plainData, replacer, indent))
					assert.equal(getTextResult, jsonStringifyResult)
				})
				await test("with ndjson", async () => {
					const getTextResult = await getText(data(), replacer, { indent, ndjson: true })
					const jsonStringifyResult = fixText(
						(Array.isArray(plainData) ? plainData : [plainData])
							.map(x => (JSON.stringify(x, replacer, indent) ?? "null") + "\n")
							.join(""),
					)
					assert.equal(getTextResult, jsonStringifyResult)
				})
			}

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
					await check(undefined, indent)
				})
			}
			await test("with a replacer", async () => {
				await check((k, x) => (typeof x === "object" ? x : String(x)))
			})
			await test("with a wrong replacer", async () => {
				await check("string")
			})
		})
	}
})

// import bfj from "bfj"
// let json = JSON.parse(String(fs.readFileSync("./1.json")))
// json = [...new Array(100)].map(() => json)

// {
// 	console.time("standard")
// 	const standard = JSON.stringify(json)
// 	console.timeEnd("standard")
// 	console.log(standard.length)

// 	{
// 		console.time("text")
// 		const text = await getText(json)
// 		console.timeEnd("text")
// 		console.log(text.length)

// 		console.log(standard === text)
// 	}

// 	{
// 		console.time("text to file")
// 		await pipeline(stringify(json), fs.createWriteStream("./00.json"))
// 		console.timeEnd("text to file")
// 	}

// 	{
// 		console.time("bfj to file stream")
// 		await pipeline(bfj.streamify(json), fs.createWriteStream("./11.json"))
// 		console.timeEnd("bfj to file stream")
// 	}

// 	{
// 		console.time("bfj to file")
// 		await bfj.write("./22.json", json)
// 		console.timeEnd("bfj to file")
// 	}
// }

// {
// 	console.time("standard+")
// 	const standard = JSON.stringify(json, undefined, 2)
// 	console.timeEnd("standard+")
// 	console.log(standard.length)

// 	console.time("text+")
// 	const text = await getText(json, undefined, 2)
// 	console.timeEnd("text+")
// 	console.log(text.length)

// 	console.log(standard === text)

// 	fs.writeFileSync("./2.json", text)
// }
