const asyncStringifyImport = import("./src/asyncStringify.js")

module.exports = {
	async *stringify(...args) {
		const { stringify } = await asyncStringifyImport
		yield* stringify(...args)
	},
}
