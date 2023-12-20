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
