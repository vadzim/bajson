const asyncStringifyImport = import("./asyncStringify.js")

module.exports = {
	async *stringify(...args) {
		const { stringify } = await asyncStringifyImport
		yield* stringify(...args)
	},
}
