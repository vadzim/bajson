import { stringify } from "../index.js"
import assert from "node:assert/strict"
import { test } from "node:test"

const time = async func => {
	// const start = process.cpuUsage()
	const start = Date.now()
	const result = await func()
	// const stop = process.cpuUsage(start)
	const stop = Date.now()
	// const duration = (stop.user + stop.system) / 1_000_000
	const duration = (stop - start) / 1_000
	return [duration, result]
}

const formatSize = size => {
	if (size < 1e3) return `${size}B`
	if (size < 1e6) return `${(size / 1e3).toFixed(2)}K`
	if (size < 1e9) return `${(size / 1e6).toFixed(2)}M`
	if (size < 1e12) return `${(size / 1e9).toFixed(2)}G`
	return `${(size / 1e12).toFixed(2)}T`
}

const refStringify = value => {
	let buffer = ""
	let result = 0
	const encoder = new TextEncoder()

	const push = chunk => {
		buffer += chunk
		if (buffer.length > 10_000) {
			const chunk = encoder.encode(buffer)
			buffer = ""
			result += chunk.length
		}
	}

	const run = item => {
		switch (typeof item) {
			case "object": {
				if (item === null) {
					push("null")
					break
				}
				if (Array.isArray(item)) {
					push("[")
					for (let i = 0; i < item.length; i++) {
						if (i > 0) push(",")
						run(item[i])
					}
					push("]")
					break
				}
				push("{")
				const items = Object.entries(item)
				for (let i = 0; i < items.length; i++) {
					if (i > 0) push(",")
					push(JSON.stringify(items[i][0]))
					push(":")
					run(items[i][1])
				}
				push("}")
				break
			}
			case "string": {
				push(JSON.stringify(item))
				break
			}
			case "number": {
				push(String(item))
				break
			}
			case "boolean": {
				push(item ? "true" : "false")
				break
			}
			case "undefined": {
				push("null")
				break
			}
			default: {
				throw new Error("unimplemented")
			}
		}
	}

	run(value)
	result += buffer.length

	return result
}

await test("performance", async () => {
	const [dataDuration, data] = await time(() =>
		[...new Array(300).keys()].map(() =>
			Object.fromEntries(
				[...new Array(100).keys()].map(index => [
					"c" + index,
					[...new Array(100).keys()].map(index => [
						"b" + index,
						// [Math.random(), Math.random(), Math.random()],
						{ x: Math.random(), y: Math.random(), z: Math.random() },
					]),
				]),
			),
		),
	)
	const [jsonDuration, json] = await time(() => JSON.stringify(data))
	const jsonData = new TextEncoder().encode(json)
	const [textDuration, [textSize, chunkCount]] = await time(async () => {
		let size = 0
		let count = 0
		for await (const chunk of stringify(data)) {
			size += chunk.length
			count++
		}
		return [size, count]
	})
	const [refDuration] = await time(async () => {
		await refStringify(data)
	})
	const message = [
		`data size: ${formatSize(jsonData.length)}`,
		`std: ${jsonDuration}s`,
		`bajson: ${textDuration}s`,
		`chunks: ${chunkCount}`,
		`ref: ${refDuration}s`,
	].join("; ")
	await test(message, () => {
		assert.equal(jsonData.length, textSize)
		assert.ok(textDuration < jsonDuration * 5)
	})
})
