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
	const message = [
		`data size: ${formatSize(jsonData.length)}`,
		`std: ${jsonDuration}s`,
		`bajson: ${textDuration}s`,
		`chunks: ${chunkCount}`,
	].join("; ")
	await test(message, () => {
		assert.equal(jsonData.length, textSize)
		assert.ok(textDuration < jsonDuration * 5)
	})
})
