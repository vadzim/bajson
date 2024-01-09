// test import
import "../index.cjs"
import "../index.js"

// main test
import { stringify, asAsyncObject } from "../index.js"
import { parse } from "../src/asyncParse.js"
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
		} else if (typeof data.then === "function") {
			// let thenable behave like toJSONable
			const value = await toPlain(await data)
			return { toJSON: key => (typeof value?.toJSON === "function" ? value.toJSON(key) : value) }
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

test(async () => {
	const text = "[]"
	return
	const { type, value: root } = await parse(text)
	for await (const { key, type, value } of root) {
	}
})
