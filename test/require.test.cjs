const { stringify } = require("../index.cjs")
const { test } = require("node:test")
const assert = require("node:assert/strict")

test("commonjs import", async () => {
	for await (const chunk of stringify("[{}]")) {
		assert.equal(String.fromCharCode(...chunk), '"[{}]"')
	}
})
